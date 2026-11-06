import { useState, type FormEvent } from 'react';
import { Radio, Send } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { api, ApiError, refreshAccessToken } from '../../lib/api';
import { useAuthStore } from '../../stores/auth';
import { connectSocket } from '../../lib/socket';
import { useDataStore } from '../../stores/data';
import type { PublicUser } from '../../lib/types';

type Mode = 'login' | 'register';
type AuthResponse = { access_token: string; user: PublicUser };

export function AuthPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const errorMessage = (err: unknown): string => {
    if (err instanceof ApiError) {
      if (err.status === 401) return t('loginFailed');
      if (err.status === 409) return err.message.includes('Email') ? t('emailTaken') : t('usernameTaken');
      return err.message;
    }
    return t('networkError');
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') {
        const data = await api<AuthResponse>('/api/auth/login', {
          method: 'POST',
          body: { email, password },
        });
        useAuthStore.getState().setSession(data.user, data.access_token);
        connectSocket();
        void useDataStore.getState().bootstrap();
        navigate('/app', { replace: true });
      } else {
        const data = await api<AuthResponse>('/api/auth/register', {
          method: 'POST',
          body: { username, display_name: displayName, email, password },
        });
        useAuthStore.getState().setSession(data.user, data.access_token);
        connectSocket();
        void useDataStore.getState().bootstrap();
        navigate('/app', { replace: true });
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full items-center justify-center p-4" style={{ background: 'var(--bg-chat)' }}>
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <div
            className="flex h-16 w-16 items-center justify-center rounded-2xl text-white"
            style={{ background: 'var(--brand-gradient)', boxShadow: '0 8px 32px var(--brand-glow)' }}
          >
            <Radio size={30} />
          </div>
          <h1 className="text-2xl font-bold">{t('appName')}</h1>
          <p className="text-sm text-[var(--text-secondary)]">{t('tagline')}</p>
        </div>

        <div className="card p-6">
          <div className="mb-5 grid grid-cols-2 gap-1 rounded-[var(--radius)] p-1" style={{ background: 'var(--bg-input)' }}>
            {(['login', 'register'] as Mode[]).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => {
                  setMode(tab);
                  setError(null);
                }}
                className="rounded-lg py-2 text-sm font-medium transition-colors"
                style={{
                  background: mode === tab ? 'var(--bg-elevated)' : 'transparent',
                  color: mode === tab ? 'var(--text-primary)' : 'var(--text-muted)',
                }}
              >
                {t(tab === 'login' ? 'login' : 'register')}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="flex flex-col gap-4">
            {mode === 'register' && (
              <>
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="text-[var(--text-secondary)]">{t('username')}</span>
                  <input
                    className="input"
                    dir="ltr"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    minLength={3}
                    maxLength={32}
                    pattern="[a-zA-Z0-9_.\-]+"
                    autoComplete="username"
                  />
                </label>
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="text-[var(--text-secondary)]">{t('displayName')}</span>
                  <input
                    className="input"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    required
                    maxLength={64}
                  />
                </label>
              </>
            )}
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-[var(--text-secondary)]">{t('email')}</span>
              <input
                className="input"
                dir="ltr"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-[var(--text-secondary)]">{t('password')}</span>
              <input
                className="input"
                dir="ltr"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={mode === 'register' ? 12 : 1}
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              />
              {mode === 'register' && <span className="text-xs text-[var(--text-muted)]">{t('passwordHint')}</span>}
            </label>

            {error && (
              <p className="rounded-[var(--radius)] bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--danger)]" role="alert">
                {error}
              </p>
            )}

            <button type="submit" className="btn btn-primary" disabled={busy}>
              <Send size={16} />
              {mode === 'login' ? t('login') : t('createAccount')}
            </button>
          </form>
        </div>

        <p className="mt-4 text-center text-sm text-[var(--text-secondary)]">
          {mode === 'login' ? t('noAccount') : t('haveAccount')}{' '}
          <button
            type="button"
            className="font-medium text-[var(--brand-accent)] hover:underline"
            onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
          >
            {mode === 'login' ? t('register') : t('login')}
          </button>
        </p>
      </div>
    </div>
  );
}

/** Boot: silently refresh the session cookie, then decide the route. */
export async function bootstrapAuth(): Promise<boolean> {
  (window as unknown as { __mgBoot: string[] }).__mgBoot = (window as unknown as { __mgBoot: string[] }).__mgBoot ?? [];
  const boot = (window as unknown as { __mgBoot: string[] }).__mgBoot;
  boot.push('bootstrap:start');
  const token = await refreshAccessToken();
  boot.push(`refresh:${token ? 'ok' : 'null'}`);
  if (!token) return false;
  try {
    const data = await api<{ user: PublicUser }>('/api/auth/me');
    boot.push('me:ok');
    useAuthStore.getState().setSession(data.user, token);
    return true;
  } catch (error) {
    boot.push(`me:fail ${(error as Error).message}`);
    useAuthStore.getState().clear();
    return false;
  }
}
