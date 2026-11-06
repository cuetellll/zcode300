import { Suspense, lazy, useEffect, useRef } from 'react';
import { Menu, Plus, Users } from 'lucide-react';
import { useI18n } from '../i18n';
import { useDataStore } from '../stores/data';
import { useUiStore } from '../stores/ui';
import { useVoiceStore } from '../stores/voice';
import { ServerRail } from '../features/workspace/ServerRail';
import { ChannelSidebar } from '../features/workspace/ChannelSidebar';
import { MemberSidebar } from '../features/workspace/MemberSidebar';
import { ChatView } from '../features/chat/ChatView';
import { DmsView } from '../features/dm/DmsView';
import { FriendsView } from '../features/friends/FriendsView';
import { VoiceStage } from '../features/voice/VoiceStage';
import { Toast } from '../components/ui';
import { onConnectionChange } from '../lib/socket';

// Heavy/rarely opened surfaces are split into their own chunks: the chat,
// voice and radio paths stay in the initial bundle.
const RadioPanel = lazy(() => import('../features/radio/RadioPanel').then((module) => ({ default: module.RadioPanel })));
const NotificationsPanel = lazy(() =>
  import('../features/notifications/NotificationsPanel').then((module) => ({ default: module.NotificationsPanel })),
);
const UserProfileModal = lazy(() =>
  import('../features/workspace/UserProfileModal').then((module) => ({ default: module.UserProfileModal })),
);
const SettingsModal = lazy(() =>
  import('../features/settings/SettingsModal').then((module) => ({ default: module.SettingsModal })),
);
const ServerModals = lazy(() => import('../features/servers/ServerModals').then((module) => ({ default: module.ServerModals })));
const CreateChannelModal = lazy(() =>
  import('../features/channels/CreateChannelModal').then((module) => ({ default: module.CreateChannelModal })),
);

export function AppShell() {
  const { t } = useI18n();
  const mainView = useUiStore((s) => s.mainView);
  const memberSidebarOpen = useUiStore((s) => s.memberSidebarOpen);
  const toggleMemberSidebar = useUiStore((s) => s.toggleMemberSidebar);
  const setMemberSidebarOpen = useUiStore((s) => s.setMemberSidebarOpen);
  const channelDrawerOpen = useUiStore((s) => s.channelDrawerOpen);
  const setChannelDrawerOpen = useUiStore((s) => s.setChannelDrawerOpen);
  const toasts = useUiStore((s) => s.toasts);
  const pushToast = useUiStore((s) => s.pushToast);
  const openModal = useUiStore((s) => s.openModal);
  const activeChannelId = useDataStore((s) => s.activeChannelId);
  const servers = useDataStore((s) => s.servers);
  const activeServerId = useDataStore((s) => s.activeServerId);
  const voiceMode = useVoiceStore((s) => s.mode);
  const voiceChannelId = useVoiceStore((s) => s.channelId);

  const activeServer = servers.find((server) => server.id === activeServerId);
  const wasConnected = useRef(false);

  useEffect(() => {
    // Only toast on a real connected → disconnected transition, never on the
    // initial mount (the socket has not connected yet at that point).
    return onConnectionChange((connected) => {
      if (!connected && wasConnected.current) pushToast(t('connectionLost'), 'error');
      wasConnected.current = connected;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const voiceChannel = activeServer?.channels?.find((channel) => channel.id === voiceChannelId);
  const activeChannel = activeServer?.channels?.find((channel) => channel.id === activeChannelId);
  const showVoiceStage = voiceMode !== 'idle' && voiceChannel && activeChannelId === voiceChannelId;

  return (
    <div className="flex h-full w-full overflow-hidden">
      <ServerRail />

      {/* ---- mobile channel drawer ---- */}
      {channelDrawerOpen && (
        <div
          className="fixed inset-0 z-30 md:hidden"
          style={{ background: 'rgba(0,0,0,0.6)' }}
          onClick={() => setChannelDrawerOpen(false)}
          aria-hidden="true"
        />
      )}
      {mainView === 'server' && (
        <div
          className={`${channelDrawerOpen ? 'flex' : 'hidden'} fixed inset-y-0 start-0 z-40 w-[250px] flex-col md:static md:z-auto md:flex md:w-[240px]`}
          style={{ background: 'var(--bg-sidebar)' }}
        >
          <ChannelSidebar />
        </div>
      )}

      <div className="flex min-w-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col" style={{ background: 'var(--bg-chat)' }}>
          {/* mobile top bar */}
          <div
            className="flex h-11 shrink-0 items-center gap-1 px-2 md:hidden"
            style={{ background: 'var(--bg-chat)', borderBottom: '1px solid var(--border-subtle)' }}
          >
            {mainView === 'server' && (
              <button
                type="button"
                className="icon-btn"
                onClick={() => setChannelDrawerOpen(true)}
                aria-label={t('channels')}
                title={t('channels')}
              >
                <Menu size={18} />
              </button>
            )}
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">
              {mainView === 'server' ? (activeServer?.name ?? t('appName')) : mainView === 'dms' ? t('directMessages') : t('friends')}
            </span>
            {mainView === 'server' && (
              <button
                type="button"
                className="icon-btn"
                onClick={() => toggleMemberSidebar()}
                aria-label={t('membersList')}
                title={t('membersList')}
              >
                <Users size={18} />
              </button>
            )}
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            {mainView === 'server' && !activeServer ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl text-white" style={{ background: 'var(--brand-gradient)' }}>
                  <Plus size={28} />
                </div>
                <h2 className="text-lg font-bold">{t('createServer')}</h2>
                <p className="max-w-xs text-sm" style={{ color: 'var(--text-secondary)' }}>
                  {t('tagline')}
                </p>
                <button type="button" className="btn btn-primary" onClick={() => openModal('createServer')}>
                  <Plus size={16} /> {t('createServer')}
                </button>
              </div>
            ) : null}
            {mainView === 'server' && activeServer && activeChannel ? (
              showVoiceStage && voiceChannel ? (
                <>
                  <VoiceStage channel={voiceChannel} />
                  <div className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                    <Suspense fallback={null}>
                      <RadioPanel channelId={voiceChannel.id} />
                    </Suspense>
                  </div>
                </>
              ) : (
                <ChatView channel={activeChannel} />
              )
            ) : null}
            {mainView === 'dms' && <DmsView />}
            {mainView === 'friends' && <FriendsView />}
          </div>
        </main>

        {mainView === 'server' && memberSidebarOpen && (
          <>
            <div
              className="fixed inset-0 z-30 md:hidden"
              style={{ background: 'rgba(0,0,0,0.6)' }}
              onClick={() => setMemberSidebarOpen(false)}
              aria-hidden="true"
            />
            <MemberSidebar />
          </>
        )}
      </div>

      <Suspense fallback={null}>
        <SettingsModal />
        <ServerModals />
        <CreateChannelModal />
        <NotificationsPanel />
        <UserProfileModal />
      </Suspense>

      <div className="pointer-events-none fixed bottom-4 start-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2 rtl:translate-x-1/2">
        {toasts.map((toast) => (
          <Toast key={toast.id} message={toast.message} tone={toast.tone} />
        ))}
      </div>
    </div>
  );
}
