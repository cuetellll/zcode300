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
  const friendsUnread = useDataStore((s) => s.friends?.incoming_requests.length ?? 0);

  return (
    <nav
      className="flex w-14 shrink-0 flex-col items-center gap-1.5 py-2 md:w-[72px] md:py-3"
      style={{ background: 'var(--bg-rail)' }}
      aria-label="Servers"
    >
      <div
        className="flex h-11 w-11 items-center justify-center rounded-2xl text-white transition-transform hover:scale-105 md:h-12 md:w-12"
        style={{ background: 'var(--brand-gradient)' }}
        title={t('appName')}
        data-tip={t('appName')}
        data-tip-side="end"
      >
        <Radio size={22} />
      </div>

      <div className="my-1 h-px w-8" style={{ background: 'var(--border-subtle)' }} />

      <RailButton active={mainView === 'dms'} onClick={() => setMainView('dms')} title={t('directMessages')} badge={dmsUnread}>
        <MessageCircle size={22} />
      </RailButton>

      <RailButton active={mainView === 'friends'} onClick={() => setMainView('friends')} title={t('friends')} badge={friendsUnread}>
        <Users size={22} />
      </RailButton>

      <div className="my-1 h-px w-8" style={{ background: 'var(--border-subtle)' }} />

      <div className="no-scrollbar flex w-full flex-1 flex-col items-center gap-1.5 overflow-y-auto">
        {servers.map((server) => {
          const serverUnread = Object.entries(unreadBadges)
            .filter(([key]) => server.channels?.some((channel) => channel.id === key))
            .reduce((sum, [, count]) => sum + count, 0);
          const hasVoice = voiceSessions.some((session) => server.channels?.some((channel) => channel.id === session.channel_id));
          const active = mainView === 'server' && activeServerId === server.id;
          return (
            <button
              key={server.id}
              type="button"
              onClick={() => {
                setMainView('server');
                void selectServer(server.id);
              }}
              className="relative flex h-11 w-11 shrink-0 items-center justify-center text-sm font-bold text-white transition-all hover:rounded-xl md:h-12 md:w-12"
              style={{
                borderRadius: active ? 12 : 22,
                background: active ? 'var(--brand-primary)' : 'var(--bg-elevated)',
              }}
              title={server.name}
              aria-label={server.name}
              aria-current={active ? 'page' : undefined}
            >
              {server.icon_text || server.name.slice(0, 2).toUpperCase()}
              {serverUnread > 0 && <UnreadDot count={serverUnread} />}
              {hasVoice && (
                <span
                  className="absolute -bottom-0.5 h-1.5 w-5 rounded-full"
                  style={{ background: 'var(--status-online)' }}
                  title={t('inVoice')}
                />
              )}
              {active && (
                <span className="absolute -start-3 top-1/2 h-8 w-1 -translate-y-1/2 rounded-full bg-white md:-start-4" />
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
      className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl transition-all hover:rounded-xl md:h-12 md:w-12"
      style={{
        background: active ? 'var(--brand-primary)' : 'var(--bg-elevated)',
        color: active ? '#fff' : 'var(--text-secondary)',
      }}
      title={title}
      aria-label={title}
      data-tip={title}
      data-tip-side="end"
    >
      {children}
      {badge > 0 && <UnreadDot count={badge} />}
    </button>
  );
}

function UnreadDot({ count }: { count: number }) {
  return (
    <span
      className="absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white"
      style={{ background: 'var(--danger)' }}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
