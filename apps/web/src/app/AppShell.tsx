import { useEffect } from 'react';
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
  const activeChannelId = useDataStore((s) => s.activeChannelId);
  const servers = useDataStore((s) => s.servers);
  const activeServerId = useDataStore((s) => s.activeServerId);
  const voiceMode = useVoiceStore((s) => s.mode);
  const voiceChannelId = useVoiceStore((s) => s.channelId);

  const activeServer = servers.find((server) => server.id === activeServerId);

  useEffect(() => {
    return onConnectionChange((connected) => {
      if (!connected) pushToast(t('connectionLost'), 'error');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const voiceChannel = activeServer?.channels?.find((c) => c.id === voiceChannelId);
  const activeChannel = activeServer?.channels?.find((c) => c.id === activeChannelId);
  const showVoiceStage = voiceMode !== 'idle' && voiceChannel && activeChannelId === voiceChannelId;

  // TEMP DEBUG: ?stage=N bisects the /app tree to locate the update loop.
  const stage = Number(new URLSearchParams(window.location.search).get('stage') ?? '99');
  if (stage === 0) {
    return <div style={{ color: '#e7e9f0', padding: 24 }}>gate-ok — authed, AppShell skeleton reached</div>;
  }

  return (
    <div className="flex h-full w-full overflow-hidden">
      {stage >= 1 && <ServerRail />}
      <div className="flex min-w-0 flex-1">
        <div className="flex w-60 shrink-0 flex-col" style={{ background: 'var(--bg-sidebar)' }}>
          {mainView === 'server' && stage >= 2 ? <ChannelSidebar /> : null}
        </div>

        <main className="flex min-w-0 flex-1 flex-col" style={{ background: 'var(--bg-chat)' }}>
          {stage >= 5 && mainView === 'server' && activeChannel ? (
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
          {stage >= 5 && mainView === 'dms' && <DmsView />}
          {stage >= 5 && mainView === 'friends' && <FriendsView />}
        </main>

        {mainView === 'server' && memberSidebarOpen && stage >= 3 && <MemberSidebar />}
      </div>

      {(stage === 4 || stage === 7) && <SettingsModal />}
      {(stage === 4 || stage === 8) && <ServerModals />}
      {(stage === 4 || stage === 9) && <CreateChannelModal />}
      {(stage === 4 || stage === 10) && <NotificationsPanel />}
      {(stage === 4 || stage === 11) && <UserProfileModal />}

      <div className="pointer-events-none fixed bottom-4 start-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2 rtl:translate-x-1/2">
        {toasts.map((toast) => (
          <Toast key={toast.id} message={toast.message} tone={toast.tone} />
        ))}
      </div>
    </div>
  );
}
