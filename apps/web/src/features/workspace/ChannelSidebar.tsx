import { useMemo } from 'react';
import { ChevronDown, Hash, HeadphoneOff, Lock, MicOff, MonitorUp, Pencil, Plus, UserPlus, Volume2, X } from 'lucide-react';
import { useI18n } from '../../i18n';
import { useAuthStore } from '../../stores/auth';
import { useDataStore } from '../../stores/data';
import { useUiStore } from '../../stores/ui';
import { useVoiceStore } from '../../stores/voice';
import { Avatar } from '../../components/ui';
import { UserPanel } from './UserPanel';
import { VoiceConnectionPanel } from '../voice/VoiceConnectionPanel';
import { ParticipantContextMenu, useParticipantMenu, useParticipantPointerHandlers } from '../voice/ParticipantMenu';
import { resolveParticipantUser } from '../voice/participant-utils';
import type { ChannelDto, MemberDto, VoiceSessionDto } from '../../lib/types';

interface VoiceRow {
  identity: string;
  name: string;
  micMuted: boolean;
  deafened: boolean;
  screenOn: boolean;
  speaking: boolean;
  isRadioBot: boolean;
  /** True when the audio of this participant is actually flowing to us. */
  controllable: boolean;
}

function VoiceMemberRow({
  row,
  members,
  openMenu,
  onOpenProfile,
}: {
  row: VoiceRow;
  members: MemberDto[];
  openMenu: (identity: string, name: string, point: { clientX: number; clientY: number }) => void;
  onOpenProfile: (identity: string) => void;
}) {
  const user = resolveParticipantUser(row.identity, row.name, members);
  const handlers = useParticipantPointerHandlers(openMenu, row.identity, user.display_name);

  return (
    <button
      type="button"
      {...handlers}
      onClick={() => {
        if (!row.isRadioBot) onOpenProfile(row.identity);
      }}
      className="flex w-full select-none items-center gap-2 rounded px-1.5 py-1 text-start transition-colors hover:bg-[var(--bg-elevated)]"
      style={{ color: row.deafened || row.micMuted ? 'var(--text-muted)' : 'var(--text-secondary)' }}
      title={user.display_name}
    >
      <Avatar user={user} size={20} speaking={row.speaking} dimmed={row.micMuted} />
      <span className="min-w-0 flex-1 truncate text-[13px] leading-5">{user.display_name}</span>
      {row.isRadioBot && (
        <span className="live-badge" style={{ background: 'var(--brand-primary)', fontSize: 9 }}>
          RADIO
        </span>
      )}
      {row.screenOn && <MonitorUp size={12} style={{ color: 'var(--status-online)' }} aria-label="screen share" />}
      {row.deafened && <HeadphoneOff size={12} style={{ color: 'var(--danger)' }} aria-label="deafened" />}
      {row.micMuted && <MicOff size={12} style={{ color: 'var(--danger)' }} aria-label="muted" />}
    </button>
  );
}

export function ChannelSidebar() {
  const { t } = useI18n();
  const servers = useDataStore((s) => s.servers);
  const activeServerId = useDataStore((s) => s.activeServerId);
  const activeChannelId = useDataStore((s) => s.activeChannelId);
  const selectChannel = useDataStore((s) => s.selectChannel);
  const unreadBadges = useDataStore((s) => s.unreadBadges);
  const voiceSessions = useDataStore((s) => s.voiceSessions);
  const membersByServer = useDataStore((s) => s.membersByServer);
  const me = useAuthStore((s) => s.user);
  const openModal = useUiStore((s) => s.openModal);
  const pushToast = useUiStore((s) => s.pushToast);
  const setChannelDrawerOpen = useUiStore((s) => s.setChannelDrawerOpen);
  const voiceMode = useVoiceStore((s) => s.mode);
  const voiceChannelId = useVoiceStore((s) => s.channelId);
  const liveParticipants = useVoiceStore((s) => s.participants);
  const speaking = useVoiceStore((s) => s.speaking);
  const joinVoice = useVoiceStore((s) => s.joinVoice);
  const leave = useVoiceStore((s) => s.leave);

  const { target: menuTarget, open: openMenu, close: closeMenu } = useParticipantMenu();

  const server = servers.find((s) => s.id === activeServerId);
  const members = useMemo(
    () => (activeServerId ? membersByServer[activeServerId] ?? [] : []),
    [activeServerId, membersByServer],
  );
  const channels: ChannelDto[] = useMemo(() => server?.channels ?? [], [server]);
  const inThisVoiceChannel = voiceMode === 'voice' && voiceChannelId !== null;

  async function onChannelClick(channel: ChannelDto): Promise<void> {
    setChannelDrawerOpen(false);
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

  function voiceRowsFor(channel: ChannelDto): VoiceRow[] {
    // Deafened is not part of the LiveKit participant snapshot, so merge it
    // from the server-side session row for the same channel.
    const sessionsHere = new Map(
      voiceSessions.filter((session: VoiceSessionDto) => session.channel_id === channel.id).map((session) => [session.user_id, session]),
    );
    if (voiceMode === 'voice' && voiceChannelId === channel.id) {
      return liveParticipants.map((participant) => ({
        identity: participant.identity,
        name: participant.name,
        micMuted: participant.micMuted,
        deafened: sessionsHere.get(participant.identity)?.deafened ?? false,
        screenOn: participant.screenOn,
        speaking: Boolean(speaking[participant.identity]) || participant.speaking,
        isRadioBot: participant.isRadioBot,
        controllable: true,
      }));
    }
    return voiceSessions
      .filter((session: VoiceSessionDto) => session.channel_id === channel.id)
      .map((session) => ({
        identity: session.user_id,
        name: session.user.display_name,
        micMuted: session.muted,
        deafened: session.deafened,
        screenOn: session.screen_sharing,
        speaking: false,
        isRadioBot: false,
        controllable: false,
      }));
  }

  const grouped = useMemo(() => {
    const map = new Map<string, ChannelDto[]>();
    for (const channel of channels) {
      const category = channel.category || t('channels');
      const list = map.get(category) ?? [];
      list.push(channel);
      map.set(category, list);
    }
    return [...map.entries()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels]);

  if (!server || !me) return <div className="flex-1" />;
  const isOwner = server.owner_id === me.id;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header
        className="flex h-12 shrink-0 items-center justify-between gap-1 px-2.5"
        style={{ borderBottom: '1px solid var(--bg-rail)', boxShadow: '0 1px 0 rgba(0,0,0,0.2)' }}
      >
        <h1 className="min-w-0 flex-1 truncate text-[15px] font-semibold">{server.name}</h1>
        <button
          type="button"
          className="icon-btn h-7 w-7"
          onClick={() => openModal('inviteManager')}
          title={t('invite')}
          aria-label={t('invite')}
          data-tip={t('invite')}
        >
          <UserPlus size={16} />
        </button>
        {isOwner && (
          <button
            type="button"
            className="icon-btn h-7 w-7"
            onClick={() => openModal('serverSettings')}
            title={t('serverSettings')}
            aria-label={t('serverSettings')}
            data-tip={t('serverSettings')}
          >
            <ChevronDown size={16} />
          </button>
        )}
        <button
          type="button"
          className="icon-btn h-7 w-7 md:hidden"
          onClick={() => setChannelDrawerOpen(false)}
          aria-label={t('close')}
        >
          <X size={16} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 pt-3" dir="auto">
        {grouped.map(([category, list]) => (
          <section key={category} className="mb-3">
            <div className="section-title">
              <span className="truncate">{category}</span>
              <button
                type="button"
                className="icon-btn h-4 w-4"
                title={t('createChannel')}
                onClick={() => openModal('createChannel')}
                aria-label={t('createChannel')}
              >
                <Plus size={12} />
              </button>
            </div>
            {list.map((channel) => {
              const unread = unreadBadges[channel.id] ?? 0;
              const active = activeChannelId === channel.id;
              const rows = channel.type === 'VOICE' ? voiceRowsFor(channel) : [];
              const connectedHere = inThisVoiceChannel && voiceChannelId === channel.id;
              return (
                <div key={channel.id} className="group/channel">
                  <button
                    type="button"
                    onClick={() => void onChannelClick(channel)}
                    className={`channel-row ${active ? 'is-active' : ''} ${unread > 0 ? 'is-unread' : ''}`}
                  >
                    {channel.type === 'VOICE' ? (
                      <Volume2 size={18} className="shrink-0" style={{ color: connectedHere ? 'var(--status-online)' : undefined }} />
                    ) : channel.is_private ? (
                      <Lock size={16} className="shrink-0" />
                    ) : (
                      <Hash size={18} className="shrink-0" />
                    )}
                    <span className="min-w-0 flex-1 truncate">{channel.name}</span>
                    {unread > 0 && (
                      <span
                        className="flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white"
                        style={{ background: 'var(--danger)' }}
                      >
                        {unread > 99 ? '99+' : unread}
                      </span>
                    )}
                    {connectedHere && (
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--status-online)' }} />
                    )}
                  </button>

                  {isOwner && (
                    <button
                      type="button"
                      className="icon-btn absolute end-1 top-1 hidden h-5 w-5 group-hover/channel:flex"
                      title={t('edit')}
                      aria-label={t('edit')}
                      onClick={() => openModal('createChannel', channel.id)}
                    >
                      <Pencil size={11} />
                    </button>
                  )}

                  {rows.length > 0 && (
                    <div className="mb-1 ms-3 mt-0.5 flex flex-col gap-0.5 border-s pe-1" style={{ borderColor: 'var(--bg-rail)' }}>
                      {rows.map((row) => (
                        <VoiceMemberRow
                          key={row.identity}
                          row={row}
                          members={members}
                          openMenu={openMenu}
                          onOpenProfile={(identity) => openModal('userProfile', identity)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        ))}
      </div>

      <VoiceConnectionPanel />
      <UserPanel />

      {menuTarget && <ParticipantContextMenu target={menuTarget} onClose={closeMenu} />}
    </div>
  );
}
