import { ChevronDown, Hash, Lock, Pencil, Plus, UserPlus, Volume2 } from 'lucide-react';
import { useMemo } from 'react';
import { useI18n } from '../../i18n';
import { useAuthStore } from '../../stores/auth';
import { useDataStore } from '../../stores/data';
import { useUiStore } from '../../stores/ui';
import { useVoiceStore } from '../../stores/voice';
import { UserPanel } from './UserPanel';
import type { ChannelDto } from '../../lib/types';

export function ChannelSidebar() {
  const { t } = useI18n();
  const servers = useDataStore((s) => s.servers);
  const activeServerId = useDataStore((s) => s.activeServerId);
  const activeChannelId = useDataStore((s) => s.activeChannelId);
  const selectChannel = useDataStore((s) => s.selectChannel);
  const unreadBadges = useDataStore((s) => s.unreadBadges);
  const voiceSessions = useDataStore((s) => s.voiceSessions);
  const me = useAuthStore((s) => s.user);
  const openModal = useUiStore((s) => s.openModal);
  const pushToast = useUiStore((s) => s.pushToast);
  const voiceMode = useVoiceStore((s) => s.mode);
  const voiceChannelId = useVoiceStore((s) => s.channelId);
  const joinVoice = useVoiceStore((s) => s.joinVoice);
  const leave = useVoiceStore((s) => s.leave);

  /** Voice channels join on click (Discord-style); clicking the connected one leaves. */
  async function onChannelClick(channel: ChannelDto): Promise<void> {
    if (channel.type !== 'VOICE') {
      await selectChannel(channel.id);
      return;
    }
    if (voiceMode === 'voice' && voiceChannelId === channel.id) {
      await leave();
      return;
    }
    await selectChannel(channel.id);
    await joinVoice(channel.id);
    const voice = useVoiceStore.getState();
    if (voice.mode === 'idle' && voice.lastError) {
      pushToast(
        voice.lastError === 'mic-permission'
          ? t('micPermissionDenied')
          : voice.lastError === 'camera-permission'
            ? t('cameraPermissionDenied')
            : voice.lastError,
        'error',
      );
      voice.clearError();
    }
  }

  const server = servers.find((s) => s.id === activeServerId);
  const channels: ChannelDto[] = useMemo(() => server?.channels ?? [], [server]);

  const grouped = useMemo(() => {
    const map = new Map<string, ChannelDto[]>();
    for (const channel of channels) {
      const category = channel.category || 'CHANNELS';
      const list = map.get(category) ?? [];
      list.push(channel);
      map.set(category, list);
    }
    return [...map.entries()];
  }, [channels]);

  if (!server || !me) return <div className="flex-1" />;
  const isOwner = server.owner_id === me.id;

  return (
    <div className="flex h-full flex-col">
      <header
        className="flex h-12 items-center justify-between px-3"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        <h1 className="truncate text-sm font-bold">{server.name}</h1>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="btn btn-ghost p-1"
            title={t('invite')}
            onClick={() => openModal('inviteManager')}
            aria-label={t('invite')}
          >
            <UserPlus size={16} />
          </button>
          {isOwner && (
            <button
              type="button"
              className="btn btn-ghost p-1"
              title={t('serverSettings')}
              onClick={() => openModal('serverSettings')}
              aria-label={t('serverSettings')}
            >
              <ChevronDown size={16} />
            </button>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-2 py-3" dir="auto">
        {grouped.map(([category, list]) => (
          <section key={category} className="mb-4">
            <div className="mb-1 flex items-center justify-between px-2">
              <h2 className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">{category}</h2>
              <button
                type="button"
                className="btn btn-ghost p-0.5"
                title={t('createChannel')}
                onClick={() => openModal('createChannel')}
                aria-label={t('createChannel')}
              >
                <Plus size={14} />
              </button>
            </div>
            {list.map((channel) => {
              const unread = unreadBadges[channel.id] ?? 0;
              const active = activeChannelId === channel.id;
              const channelVoice = voiceSessions.filter((s) => s.channel_id === channel.id);
              return (
                <div key={channel.id} className="group/channel relative">
                  <button
                    type="button"
                    onClick={() => void onChannelClick(channel)}
                    className="mb-0.5 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-start text-sm transition-colors hover:bg-[var(--bg-elevated)]"
                    style={{
                      background: active ? 'var(--bg-elevated)' : undefined,
                      color: active || unread > 0 ? 'var(--text-primary)' : 'var(--text-secondary)',
                      fontWeight: active || unread > 0 ? 600 : 400,
                    }}
                  >
                    {channel.type === 'VOICE' ? (
                      <Volume2 size={16} className="shrink-0" />
                    ) : channel.is_private ? (
                      <Lock size={15} className="shrink-0" />
                    ) : (
                      <Hash size={15} className="shrink-0" />
                    )}
                    <span className="min-w-0 flex-1 truncate">{channel.name}</span>
                    {unread > 0 && (
                      <span
                        className="flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white"
                        style={{ background: 'var(--danger)' }}
                      >
                        {unread}
                      </span>
                    )}
                  </button>
                  {isOwner && (
                    <button
                      type="button"
                      className="btn btn-ghost absolute end-1 top-1 hidden p-0.5 group-hover/channel:block"
                      title={t('edit')}
                      aria-label={t('edit')}
                      onClick={() => openModal('createChannel', channel.id)}
                    >
                      <Pencil size={12} />
                    </button>
                  )}
                  {channel.type === 'VOICE' && channelVoice.length > 0 && (
                    <div className="mb-1 ms-6 flex flex-col gap-0.5">
                      {channelVoice.map((session) => (
                        <div key={session.id} className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                          <span
                            className="h-1.5 w-1.5 rounded-full"
                            style={{ background: session.muted ? 'var(--status-dnd)' : 'var(--status-online)' }}
                          />
                          <span className="truncate">{session.user.display_name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        ))}
      </div>

      <UserPanel />
    </div>
  );
}
