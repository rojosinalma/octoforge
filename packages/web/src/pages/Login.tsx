import { type FormEvent, useState } from 'react';
import { Ui } from 'tailor-react';
import { api } from '../api';
import { Logo } from '../components/Header';

export function LoginPage({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      onLoggedIn();
    } catch (err) {
      setError((err as Error).message || 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="app-center">
      <Ui.Card className="login-card">
        <Ui.Card.Body>
          <Ui.Form className="t-stack" onSubmit={(e) => void submit(e)}>
            <h1 className="t-page-title login-title">
              <Logo size={28} /> Octoforge
            </h1>
            <p className="t-muted">Enter the password configured for this instance.</p>
            <Ui.Field label="Password" error={error ?? undefined}>
              <Ui.Input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
              />
            </Ui.Field>
            <Ui.Button type="submit" variant="primary" busy={busy} disabled={!password}>
              {busy ? 'Signing in…' : 'Sign in'}
            </Ui.Button>
          </Ui.Form>
        </Ui.Card.Body>
      </Ui.Card>
    </main>
  );
}
