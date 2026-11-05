import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { I18nProvider } from '../i18n';
import { useAuthStore } from '../stores/auth';
import { AuthPage, bootstrapAuth } from '../features/auth/AuthPage';
import { AppShell } from './AppShell';
import { Spinner } from '../components/ui';
import { connectSocket, disconnectSocket } from '../lib/socket';
import { useDataStore } from '../stores/data';
import { api } from '../lib/api';

/** Consume a ?invite=CODE deep link once, after login. */
async function consumePendingInvite(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('invite');
  if (!code) return;
  try {
    const data = await api<{ server: { id: string } }>('/api/servers/join', {
      method: 'POST',
      body: { code },
    });
    if (data.server?.id) {
      const refreshed = await api<{ servers: never[] }>('/api/servers');
      useDataStore.setState({ servers: refreshed.servers });
      await useDataStore.getState().selectServer(data.server.id);
    }
  } catch {
    // invalid/expired invite — ignore, the user continues normally
  } finally {
    params.delete('invite');
    const query = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
  }
}

function WorkspaceGate() {
  const status = useAuthStore((s) => s.status);
  const [booting, setBooting] = useState(true);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void bootstrapAuth().then((authed) => {
      if (cancelled) return;
      if (authed) {
        connectSocket();
        void useDataStore
          .getState()
          .bootstrap()
          .then(() => consumePendingInvite())
          .catch(() => undefined)
          .finally(() => {
            if (!cancelled) setReady(true);
          });
      }
      setBooting(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (booting || (status === 'authed' && !ready)) {
    return <Spinner />;
  }
  if (status !== 'authed') {
    return <Navigate to="/login" replace />;
  }
  return <AppShell />;
}

export function App() {
  useEffect(() => {
    return () => disconnectSocket();
  }, []);

  return (
    <I18nProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<AuthPage />} />
          <Route path="/app" element={<WorkspaceGate />} />
          <Route path="*" element={<Navigate to="/app" replace />} />
        </Routes>
      </BrowserRouter>
    </I18nProvider>
  );
}
