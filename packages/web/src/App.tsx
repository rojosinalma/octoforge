import { Spinner } from '@primer/react';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { api, onAuthError } from './api';
import { AppProvider, useApp } from './hooks/useApp';
import { ToastProvider } from './hooks/useToast';
import { CredentialsPage } from './pages/Credentials';
import { DatabasePage } from './pages/Database';
import { GitHubAppPage } from './pages/GitHubApp';
import { IndexPage } from './pages/Index';
import { LogPage } from './pages/Log';
import { LoginPage } from './pages/Login';
import { SettingsPage } from './pages/Settings';
import { useRoute } from './router';
import { readCachedTheme, ThemeRoot } from './theme';

type Auth = { state: 'loading' } | { state: 'login' } | { state: 'ready'; required: boolean };

function Routes() {
  const route = useRoute();
  const cred = /^\/members\/([a-z0-9-]+)\/credentials$/.exec(route.path);
  if (cred?.[1]) return <CredentialsPage key={cred[1]} member={cred[1]} />;
  if (route.path === '/settings') return <SettingsPage />;
  if (route.path === '/github-app') return <GitHubAppPage />;
  if (route.path === '/database') return <DatabasePage />;
  if (route.path === '/log') return <LogPage />;
  return <IndexPage />;
}

/** Applies the server-side theme once settings arrive; the cached one covers the first paint. */
function Themed({ children }: { children: ReactNode }) {
  const { settings, settingsLoaded } = useApp();
  return <ThemeRoot theme={settingsLoaded ? settings.theme : readCachedTheme()}>{children}</ThemeRoot>;
}

export function App() {
  const [auth, setAuth] = useState<Auth>({ state: 'loading' });

  const check = useCallback(async () => {
    try {
      const r = await api.authStatus();
      setAuth(r.required && !r.authenticated ? { state: 'login' } : { state: 'ready', required: r.required });
    } catch {
      setAuth({ state: 'ready', required: false });
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);
  useEffect(() => onAuthError(() => setAuth({ state: 'login' })), []);

  if (auth.state === 'loading') {
    return (
      <ThemeRoot theme={readCachedTheme()}>
        <div className="app-loading">
          <Spinner srText="Loading" />
        </div>
      </ThemeRoot>
    );
  }
  if (auth.state === 'login') {
    return (
      <ThemeRoot theme={readCachedTheme()}>
        <LoginPage onLoggedIn={() => void check()} />
      </ThemeRoot>
    );
  }
  return (
    <ToastProvider>
      <AppProvider authRequired={auth.required} onLoggedOut={() => setAuth({ state: 'login' })}>
        <Themed>
          <Routes />
        </Themed>
      </AppProvider>
    </ToastProvider>
  );
}
