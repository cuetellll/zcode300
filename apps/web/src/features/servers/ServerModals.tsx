import { useEffect, useState } from 'react';
import { Copy, Link2, Plus, Trash2 } from 'lucide-react';
import { useI18n } from '../../i18n';
import { api } from '../../lib/api';
import { useDataStore } from '../../stores/data';
import { useUiStore } from '../../stores/ui';
import { Modal, Spinner } from '../../components/ui';


export function ServerModals() {
  const { t } = useI18n();
  const modal = useUiStore((s) => s.modal);
  const closeModal = useUiStore((s) => s.closeModal);
  const openModal = useUiStore((s) => s.openModal);
  const pushToast = useUiStore((s) => s.pushToast);
  const servers = useDataStore((s) => s.servers);
  const selectServer = useDataStore((s) => s.selectServer);
  const membersByServer = useDataStore((s) => s.membersByServer);
  const activeServerId = useDataStore((s) => s.activeServerId);
  const activeServer = servers.find((s) => s.id === activeServerId);

  const [serverName, setServerName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [invites, setInvites] = useState<Array<{ id: string; code: string; uses: number; max_uses: number | null; expires_at: string | null }>>([]);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'overview' | 'members' | 'roles'>('overview');

  useEffect(() => {
    if (modal === 'joinServer') {
      setJoinCode('');
    }
    if (modal === 'inviteManager' && activeServerId) {
      void api<{ invitations: typeof invites }>(`/api/servers/${activeServerId}/invites`).then((data) => setInvites(data.invitations));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modal, activeServerId]);

  if (modal === 'createServer') {
    return (
      <Modal title={t('createServer')} onClose={closeModal}>
        <div className="grid gap-2">
          <form
            className="grid gap-3"
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              try {
                const data = await api<{ server: { id: string } }>('/api/servers', {
                  method: 'POST',
                  body: { name: serverName },
                });
                await useDataStore.getState().refreshConversations();
                const refreshed = await api<{ servers: typeof servers }>('/api/servers');
                useDataStore.setState({ servers: refreshed.servers });
                closeModal();
                void selectServer(data.server.id);
              } catch (error) {
                pushToast((error as Error).message, 'error');
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-[var(--text-secondary)]">{t('serverName')}</span>
              <input className="input" value={serverName} onChange={(e) => setServerName(e.target.value)} required maxLength={100} autoFocus />
            </label>
            <button type="submit" className="btn btn-primary" disabled={busy || !serverName.trim()}>
              <Plus size={15} /> {t('create')}
            </button>
          </form>
          <div className="my-1 h-px" style={{ background: 'var(--border-subtle)' }} />
          <button type="button" className="btn btn-secondary" onClick={() => openModal('joinServer')}>
            <Link2 size={15} /> {t('joinServer')}
          </button>
        </div>
      </Modal>
    );
  }

  if (modal === 'joinServer') {
    return (
      <Modal title={t('joinServer')} onClose={closeModal}>
        <form
          className="grid gap-3"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            try {
              const data = await api<{ server: { id: string } }>('/api/servers/join', {
                method: 'POST',
                body: { code: joinCode.trim() },
              });
              const refreshed = await api<{ servers: typeof servers }>('/api/servers');
              useDataStore.setState({ servers: refreshed.servers });
              closeModal();
              void selectServer(data.server.id);
            } catch (error) {
              pushToast((error as Error).message, 'error');
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[var(--text-secondary)]">{t('inviteCode')}</span>
            <input className="input" dir="ltr" value={joinCode} onChange={(e) => setJoinCode(e.target.value)} required autoFocus />
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {t('join')}
          </button>
        </form>
      </Modal>
    );
  }

  if (modal === 'inviteManager' && activeServer) {
    const joinLink = (code: string) => `${window.location.origin}/app?invite=${code}`;
    return (
      <Modal title={`${t('invites')} — ${activeServer.name}`} onClose={closeModal} width={520}>
        <div className="mb-4 rounded-[var(--radius)] p-3 text-sm" style={{ background: 'var(--bg-input)' }}>
          <div className="mb-1 text-xs text-[var(--text-muted)]">{t('inviteCode')} (permanent)</div>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate text-xs" dir="ltr">
              {activeServer.invite_code}
            </code>
            <button
              type="button"
              className="btn btn-ghost p-1"
              title={t('copyLink')}
              onClick={async () => {
                await navigator.clipboard.writeText(joinLink(activeServer.invite_code));
                pushToast(t('copied'));
              }}
            >
              <Copy size={14} />
            </button>
          </div>
        </div>

        <form
          className="mb-4 flex gap-2"
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              await api(`/api/servers/${activeServer.id}/invites`, { method: 'POST', body: {} });
              const data = await api<{ invitations: typeof invites }>(`/api/servers/${activeServer.id}/invites`);
              setInvites(data.invitations);
            } catch (error) {
              pushToast((error as Error).message, 'error');
            }
          }}
        >
          <button type="submit" className="btn btn-primary flex-1">
            <Plus size={15} /> {t('createInvite')}
          </button>
        </form>

        <ul className="max-h-56 space-y-1 overflow-y-auto">
          {invites.map((invite) => (
            <li key={invite.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs" style={{ background: 'var(--bg-input)' }}>
              <code dir="ltr" className="min-w-0 flex-1 truncate">{invite.code}</code>
              <span className="text-[var(--text-muted)]">
                {invite.uses}/{invite.max_uses ?? '∞'}
                {invite.expires_at ? ` · ⏳ ${new Date(invite.expires_at).toLocaleDateString()}` : ''}
              </span>
              <button
                type="button"
                className="btn btn-ghost p-1"
                onClick={async () => {
                  await navigator.clipboard.writeText(joinLink(invite.code));
                  pushToast(t('copied'));
                }}
              >
                <Copy size={13} />
              </button>
              <button
                type="button"
                className="btn btn-ghost p-1"
                title={t('revoke')}
                onClick={async () => {
                  await api(`/api/invites/${invite.id}`, { method: 'DELETE' });
                  setInvites((prev) => prev.filter((i) => i.id !== invite.id));
                }}
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      </Modal>
    );
  }

  if (modal === 'serverSettings' && activeServer) {
    return <ServerSettingsModal serverId={activeServer.id} tab={tab} setTab={setTab} onClose={closeModal} />;
  }

  return null;
}

function ServerSettingsModal({
  serverId,
  tab,
  setTab,
  onClose,
}: {
  serverId: string;
  tab: 'overview' | 'members' | 'roles';
  setTab: (tab: 'overview' | 'members' | 'roles') => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const pushToast = useUiStore((s) => s.pushToast);
  const members = useDataStore((s) => s.membersByServer[serverId] ?? []);
  const roles = useDataStore((s) => s.rolesByServer[serverId] ?? []);
  const [serverName, setServerName] = useState('');
  const [roleName, setRoleName] = useState('');
  const [roleColor, setRoleColor] = useState('#99AAB5');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const server = useDataStore.getState().servers.find((s) => s.id === serverId);
    setServerName(server?.name ?? '');
    setLoaded(true);
  }, [serverId]);

  const server = useDataStore((s) => s.servers.find((x) => x.id === serverId));

  if (!loaded || !server) return <Spinner />;

  async function rename() {
    try {
      await api(`/api/servers/${serverId}`, { method: 'PATCH', body: { name: serverName } });
      pushToast(t('save') + ' ✓');
    } catch (error) {
      pushToast((error as Error).message, 'error');
    }
  }

  return (
    <Modal title={`${t('serverSettings')} — ${server.name}`} onClose={onClose} width={560}>
      <div className="mb-4 flex gap-1">
        {(['overview', 'members', 'roles'] as const).map((tabKey) => (
          <button
            key={tabKey}
            type="button"
            className="btn text-xs"
            onClick={() => setTab(tabKey)}
            style={{
              background: tab === tabKey ? 'var(--bg-elevated)' : undefined,
              color: tab === tabKey ? 'var(--text-primary)' : 'var(--text-secondary)',
            }}
          >
            {tabKey === 'overview' ? t('profile') : tabKey === 'members' ? t('members') : t('roles')}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="grid gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[var(--text-secondary)]">{t('serverName')}</span>
            <div className="flex gap-2">
              <input className="input" value={serverName} onChange={(e) => setServerName(e.target.value)} maxLength={100} />
              <button type="button" className="btn btn-primary" onClick={() => void rename()}>
                {t('save')}
              </button>
            </div>
          </label>
          <div className="flex gap-2 border-t pt-3" style={{ borderColor: 'var(--border-subtle)' }}>
            <button
              type="button"
              className="btn btn-secondary text-xs"
              onClick={async () => {
                if (!window.confirm(t('leaveServer') + '?')) return;
                try {
                  await api(`/api/servers/${serverId}/leave`, { method: 'POST' });
                  useDataStore.setState((state) => ({ servers: state.servers.filter((s) => s.id !== serverId) }));
                  onClose();
                } catch (error) {
                  pushToast((error as Error).message, 'error');
                }
              }}
            >
              {t('leaveServer')}
            </button>
            <button
              type="button"
              className="btn btn-danger text-xs"
              onClick={async () => {
                if (!window.confirm(t('deleteServer') + '?')) return;
                try {
                  await api(`/api/servers/${serverId}`, { method: 'DELETE' });
                  useDataStore.setState((state) => ({ servers: state.servers.filter((s) => s.id !== serverId) }));
                  onClose();
                } catch (error) {
                  pushToast((error as Error).message, 'error');
                }
              }}
            >
              {t('deleteServer')}
            </button>
          </div>
        </div>
      )}

      {tab === 'members' && (
        <ul className="max-h-80 space-y-1 overflow-y-auto">
          {members.map((member) => (
            <li key={member.id} className="flex items-center gap-2 rounded-md px-2 py-1.5" style={{ background: 'var(--bg-input)' }}>
              <span className="min-w-0 flex-1 truncate text-sm">
                {member.nickname || member.user.display_name}
                {server.owner_id === member.user_id && <span className="ms-1 text-[10px] text-[var(--brand-accent)]">★</span>}
              </span>
              <span className="hidden text-xs text-[var(--text-muted)] sm:block">
                {member.role_ids.map((roleId) => roles.find((r) => r.id === roleId)?.name).filter(Boolean).join(', ')}
              </span>
              {server.owner_id !== member.user_id && (
                <>
                  <button
                    type="button"
                    className="btn btn-ghost p-1 text-xs"
                    title={t('kick')}
                    onClick={async () => {
                      try {
                        await api(`/api/servers/${serverId}/members/${member.id}`, { method: 'DELETE' });
                        await useDataStore.getState().loadServerDetail(serverId);
                      } catch (error) {
                        pushToast((error as Error).message, 'error');
                      }
                    }}
                  >
                    {t('kick')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost p-1 text-xs text-[var(--danger)]"
                    title={t('ban')}
                    onClick={async () => {
                      try {
                        await api(`/api/servers/${serverId}/bans`, { method: 'POST', body: { user_id: member.user_id } });
                        await useDataStore.getState().loadServerDetail(serverId);
                      } catch (error) {
                        pushToast((error as Error).message, 'error');
                      }
                    }}
                  >
                    {t('ban')}
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {tab === 'roles' && (
        <div className="grid gap-3">
          <div className="flex gap-2">
            <input className="input" placeholder={t('roleName')} value={roleName} onChange={(e) => setRoleName(e.target.value)} maxLength={64} />
            <input type="color" className="h-9 w-12 cursor-pointer rounded-md border-0 bg-transparent" value={roleColor} onChange={(e) => setRoleColor(e.target.value)} aria-label={t('color')} />
            <button
              type="button"
              className="btn btn-primary"
              onClick={async () => {
                if (!roleName.trim()) return;
                try {
                  await api(`/api/servers/${serverId}/roles`, {
                    method: 'POST',
                    body: { name: roleName.trim(), color: roleColor, position: 1 },
                  });
                  setRoleName('');
                  await useDataStore.getState().loadServerDetail(serverId);
                } catch (error) {
                  pushToast((error as Error).message, 'error');
                }
              }}
            >
              <Plus size={15} />
            </button>
          </div>
          <ul className="max-h-64 space-y-1 overflow-y-auto">
            {roles.map((role) => (
              <li key={role.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm" style={{ background: 'var(--bg-input)' }}>
                <span className="h-3 w-3 rounded-full" style={{ background: role.color }} />
                <span className="min-w-0 flex-1 truncate">{role.name}</span>
                <span className="text-[10px] text-[var(--text-muted)]">{(role.permissions ?? []).length} {t('permissions')}</span>
                {role.name !== '@everyone' && (
                  <button
                    type="button"
                    className="btn btn-ghost p-1"
                    onClick={async () => {
                      try {
                        await api(`/api/servers/${serverId}/roles/${role.id}`, { method: 'DELETE' });
                        await useDataStore.getState().loadServerDetail(serverId);
                      } catch (error) {
                        pushToast((error as Error).message, 'error');
                      }
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}
