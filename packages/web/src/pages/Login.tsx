import { Button, FormControl, Heading, TextInput } from '@primer/react';
import { type FormEvent, useState } from 'react';
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
    <main className="login-page">
      <form className="login-card" onSubmit={(e) => void submit(e)}>
        <Heading as="h1" className="login-title">
          <Logo size={28} /> Octoforge
        </Heading>
        <p className="fg-muted">Enter the password configured for this instance.</p>
        <FormControl required>
          <FormControl.Label>Password</FormControl.Label>
          <TextInput
            block
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            validationStatus={error ? 'error' : undefined}
            autoFocus
          />
          {error && <FormControl.Validation variant="error">{error}</FormControl.Validation>}
        </FormControl>
        <Button type="submit" variant="primary" block disabled={busy || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </main>
  );
}
