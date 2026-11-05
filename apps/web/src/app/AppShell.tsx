import { useEffect, useRef } from 'react';
import { Plus } from 'lucide-react';
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
import { RadioPanel } from '../features/radio/RadioPanel';
import { NotificationsPanel } from '../features/notifications/NotificationsPanel';
import { UserProfileModal } from '../features/workspace/UserProfileModal';
import { SettingsModal } from '../features/settings/SettingsModal';
import { ServerModals } from '../features/servers/ServerModals';
import { CreateChannelModal } from '../features/channels/CreateChannelModal';
import { Toast } from '../components/ui';
import { onConnectionChange } from '../lib/socket';

export function AppShell() {
  const { t } = useI18n();
  const mainView = useUiStore((s) => s.mainView);
  const memberSidebarOpen = useUiStore((s) => s.memberSidebarOpen);
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

  const voiceChannel = activeServer?.channels?.find((c) => c.id === voiceChannelId);
  const activeChannel = activeServer?.channels?.find((c) => c.id === activeChannelId);
  const showVoiceStage = voiceMode !== 'idle' && voiceChannel && activeChannelId === voiceChannelId;

  return (
    <div className="flex h-full w-full overflow-hidden">
      <ServerRail />
      <div className="flex min-w-0 flex-1">
        <div className="flex w-60 shrink-0 flex-col" style={{ background: 'var(--bg-sidebar)' }}>
          {mainView === 'server' ? <ChannelSidebar /> : null}
        </div>

        <main className="flex min-w-0 flex-1 flex-col" style={{ background: 'var(--bg-chat)' }}>
          {mainView === 'server' && !activeServer ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
              <div
                className="flex h-16 w-16 items-center justify-center rounded-2xl text-white"
                style={{ background: 'var(--brand-gradient)' }}
              >
                <Plus size={28} />
              </div>
              <h2 className="text-lg font-bold">{t('createServer')}</h2>
              <p className="max-w-xs text-sm text-[var(--text-secondary)]">{t('tagline')}</p>
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
                  <RadioPanel channelId={voiceChannel.id} />
                </div>
              </>
            ) : (
              <ChatView channel={activeChannel} />
            )
          ) : null}
          {mainView === 'dms' && <DmsView />}
          {mainView === 'friends' && <FriendsView />}
        </main>

        {mainView === 'server' && memberSidebarOpen && <MemberSidebar />}
      </div>

      <SettingsModal />
      <ServerModals />
      <CreateChannelModal />
      <NotificationsPanel />
      <UserProfileModal />

      <div className="pointer-events-none fixed bottom-4 start-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2 rtl:translate-x-1/2">
        {toasts.map((toast) => (
          <Toast key={toast.id} message={toast.message} tone={toast.tone} />
        ))}
      </div>
    </div>
  );
}
