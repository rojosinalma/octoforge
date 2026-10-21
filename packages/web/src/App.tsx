import { useCallback, useEffect, useState } from 'react';
import { Ui } from 'tailor-react';
import { api, onAuthError } from './api';
import { AppProvider } from './hooks/useApp';
import { CredentialsPage } from './pages/Credentials';
import { DatabasePage } from './pages/Database';
import { GitHubAppPage } from './pages/GitHubApp';
import { IndexPage } from './pages/Index';
import { LogPage } from './pages/Log';
import { LoginPage } from './pages/Login';
import { SettingsPage } from './pages/Settings';
import { useRoute } from './router';
import { ThemeSync } from './theme';

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

  return (
    <Ui.Provider>
      {auth.state === 'loading' ? (
        <div className="app-center">
          <Ui.Spinner />
        </div>
      ) : auth.state === 'login' ? (
        <LoginPage onLoggedIn={() => void check()} />
      ) : (
        <AppProvider authRequired={auth.required} onLoggedOut={() => setAuth({ state: 'login' })}>
          <ThemeSync />
          <Routes />
        </AppProvider>
      )}
    </Ui.Provider>
  );
}
