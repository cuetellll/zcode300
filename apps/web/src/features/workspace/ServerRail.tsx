import { MessageCircle, Plus, Radio, Settings, Users } from 'lucide-react';
import { useI18n } from '../../i18n';
import { useDataStore } from '../../stores/data';
import { useUiStore } from '../../stores/ui';

export function ServerRail() {
  const { t } = useI18n();
  const servers = useDataStore((s) => s.servers);
  const activeServerId = useDataStore((s) => s.activeServerId);
  const selectServer = useDataStore((s) => s.selectServer);
  const unreadBadges = useDataStore((s) => s.unreadBadges);
  const voiceSessions = useDataStore((s) => s.voiceSessions);
  const mainView = useUiStore((s) => s.mainView);
  const setMainView = useUiStore((s) => s.setMainView);
  const openModal = useUiStore((s) => s.openModal);
  const modal = useUiStore((s) => s.modal);

  const dmsUnread = Object.entries(unreadBadges)
    .filter(([key]) => key.startsWith('dm_'))
    .reduce((sum, [, count]) => sum + count, 0);
  const friendsUnread = useDataStore(
    (s) => s.friends?.incoming_requests.length ?? 0,
  );

  return (
    <nav
      className="flex w-[72px] shrink-0 flex-col items-center gap-2 py-3"
      style={{ background: 'var(--bg-rail)' }}
      aria-label="Servers"
    >
      <div
        className="flex h-12 w-12 items-center justify-center rounded-2xl text-white"
        style={{ background: 'var(--brand-gradient)', boxShadow: '0 4px 16px var(--brand-glow)' }}
        title={t('appName')}
      >
        <Radio size={22} />
      </div>

      <div className="my-1 h-px w-8" style={{ background: 'var(--border-subtle)' }} />

      <RailButton
        active={mainView === 'dms'}
        onClick={() => setMainView('dms')}
        title={t('directMessages')}
        badge={dmsUnread}
      >
        <MessageCircle size={22} />
      </RailButton>

      <RailButton
        active={mainView === 'friends'}
        onClick={() => setMainView('friends')}
        title={t('friends')}
        badge={friendsUnread}
      >
        <Users size={22} />
      </RailButton>

      <div className="my-1 h-px w-8" style={{ background: 'var(--border-subtle)' }} />

      <div className="flex w-full flex-1 flex-col items-center gap-2 overflow-y-auto">
        {servers.map((server) => {
          const serverUnread = Object.entries(unreadBadges)
            .filter(([key]) => server.channels?.some((c) => c.id === key))
            .reduce((sum, [, count]) => sum + count, 0);
          const hasVoice = voiceSessions.some((session) =>
            server.channels?.some((c) => c.id === session.channel_id),
          );
          const active = mainView === 'server' && activeServerId === server.id;
          return (
            <button
              key={server.id}
              type="button"
              onClick={() => {
                setMainView('server');
                void selectServer(server.id);
              }}
              className="relative flex h-12 w-12 items-center justify-center rounded-2xl text-sm font-bold text-white transition-all hover:rounded-xl"
              style={{
                background: active ? 'var(--brand-primary)' : 'var(--bg-elevated)',
                boxShadow: active ? '0 4px 16px var(--brand-glow)' : undefined,
              }}
              title={server.name}
            >
              {server.icon_text || server.name.slice(0, 2).toUpperCase()}
              {serverUnread > 0 && <UnreadDot />}
              {hasVoice && (
                <span
                  className="absolute -bottom-0.5 h-1.5 w-5 rounded-full"
                  style={{ background: 'var(--status-online)' }}
                />
              )}
            </button>
          );
        })}
      </div>

      <RailButton
        active={modal === 'createServer' || modal === 'joinServer'}
        onClick={() => openModal('createServer')}
        title={t('addServer')}
      >
        <Plus size={22} />
      </RailButton>
      <RailButton active={modal === 'settings'} onClick={() => openModal('settings')} title={t('settings')}>
        <Settings size={22} />
      </RailButton>
    </nav>
  );
}

function RailButton({
  children,
  active,
  onClick,
  title,
  badge = 0,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  title: string;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative flex h-12 w-12 items-center justify-center rounded-2xl transition-all hover:rounded-xl"
      style={{
        background: active ? 'var(--bg-elevated)' : 'transparent',
        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
      }}
      title={title}
      aria-label={title}
    >
      {children}
      {badge > 0 && <UnreadDot />}
    </button>
  );
}

function UnreadDot() {
  return (
    <span
      className="absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white"
      style={{ background: 'var(--danger)' }}
    />
  );
}
