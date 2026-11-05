import { create } from 'zustand';
import { api } from '../lib/api';
import { emitSocket, onConnect } from '../lib/socket';
import type {
  ConversationDto,
  DmMessageDto,
  FriendsPayload,
  MemberDto,
  MessageDto,
  NotificationDto,
  RadioStateDto,
  RadioStationDto,
  RoleDto,
  ServerDto,
  VoiceSessionDto,
} from '../lib/types';

const LAST_READ_KEY = 'mahyar_gap_last_read';

function readLastReadMap(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(LAST_READ_KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

function writeLastReadMap(map: Record<string, string>): void {
  localStorage.setItem(LAST_READ_KEY, JSON.stringify(map));
}

interface DataState {
  servers: ServerDto[];
  membersByServer: Record<string, MemberDto[]>;
  rolesByServer: Record<string, RoleDto[]>;
  activeServerId: string | null;
  activeChannelId: string | null;

  messagesByChannel: Record<string, MessageDto[]>;
  hasMoreByChannel: Record<string, boolean>;
  conversations: ConversationDto[];
  dmMessages: Record<string, DmMessageDto[]>;
  dmHasMore: Record<string, boolean>;
  activeConversationId: string | null;

  friends: FriendsPayload | null;
  presence: Record<string, true>;
  voiceSessions: VoiceSessionDto[];
  notifications: NotificationDto[];
  unreadBadges: Record<string, number>;
  typing: Record<string, string[]>; // channelId -> userIds
  dmTyping: Record<string, string[]>;
  radioStates: Record<string, RadioStateDto>;
  radioStations: RadioStationDto[];
  radioEnabled: boolean;
  connected: boolean;

  bootstrap: () => Promise<void>;
  selectServer: (serverId: string) => Promise<void>;
  selectChannel: (channelId: string) => Promise<void>;
  selectConversation: (conversationId: string) => Promise<void>;
  loadServerDetail: (serverId: string) => Promise<void>;
  loadOlderMessages: (channelId: string) => Promise<void>;
  loadOlderDmMessages: (conversationId: string) => Promise<void>;
  markChannelRead: (channelId: string) => void;
  refreshVoiceSessions: () => Promise<void>;
  refreshNotifications: () => Promise<void>;
  refreshFriends: () => Promise<void>;
  refreshConversations: () => Promise<void>;
  refreshRadio: () => Promise<void>;
}

export const useDataStore = create<DataState>((set, get) => {
  onConnect(() => {
    set({ connected: true });
    joinCurrentRooms();
  });

  return {
    servers: [],
    membersByServer: {},
    rolesByServer: {},
    activeServerId: null,
    activeChannelId: null,
    messagesByChannel: {},
    hasMoreByChannel: {},
    conversations: [],
    dmMessages: {},
    dmHasMore: {},
    activeConversationId: null,
    friends: null,
    presence: {},
    voiceSessions: [],
    notifications: [],
    unreadBadges: {},
    typing: {},
    dmTyping: {},
    radioStates: {},
    radioStations: [],
    radioEnabled: false,
    connected: false,

    async bootstrap() {
      const [{ servers }, friends, { notifications }, { sessions }] = await Promise.all([
        api<{ servers: ServerDto[] }>('/api/servers'),
        api<FriendsPayload>('/api/friends'),
        api<{ notifications: NotificationDto[] }>('/api/notifications?limit=30'),
        api<{ sessions: VoiceSessionDto[] }>('/api/voice/sessions'),
      ]);
      set({ servers, friends, notifications, voiceSessions: sessions });
      for (const server of servers) {
        emitSocket('server:join', server.id);
      }
      await get().refreshConversations();
      try {
        const radio = await api<{ enabled: boolean; stations: RadioStationDto[] }>('/api/radio/stations');
        set({ radioEnabled: radio.enabled, radioStations: radio.stations });
      } catch {
        set({ radioEnabled: false });
      }
      if (servers.length > 0) {
        await get().selectServer(servers[0].id);
      }
    },

    async selectServer(serverId) {
      set({ activeServerId: serverId, activeChannelId: null, activeConversationId: null });
      emitSocket('server:join', serverId);
      await get().loadServerDetail(serverId);
      const server = get().servers.find((s) => s.id === serverId);
      const firstText = (server?.channels ?? []).find((c) => c.type === 'TEXT');
      if (firstText) await get().selectChannel(firstText.id);
    },

    async loadServerDetail(serverId) {
      const detail = await api<{
        server: ServerDto;
        members: MemberDto[];
        roles: RoleDto[];
        bans: Array<{ user_id: string }>;
      }>(`/api/servers/${serverId}`);
      set((state) => ({
        servers: state.servers.some((s) => s.id === serverId)
          ? state.servers.map((s) =>
              s.id === serverId
                ? { ...s, ...detail.server, channels: detail.server.channels ?? s.channels }
                : s,
            )
          : [...state.servers, { ...detail.server }],
        membersByServer: { ...state.membersByServer, [serverId]: detail.members },
        rolesByServer: { ...state.rolesByServer, [serverId]: detail.roles },
      }));
    },

    async selectChannel(channelId) {
      set((state) => ({
        activeChannelId: channelId,
        activeConversationId: null,
        unreadBadges: { ...state.unreadBadges, [channelId]: 0 },
      }));
      emitSocket('channel:join', channelId);
      get().markChannelRead(channelId);
      if (!get().messagesByChannel[channelId]) {
        const data = await api<{ messages: MessageDto[]; has_more: boolean }>(
          `/api/channels/${channelId}/messages?limit=50`,
        );
        set((state) => ({
          messagesByChannel: { ...state.messagesByChannel, [channelId]: data.messages },
          hasMoreByChannel: { ...state.hasMoreByChannel, [channelId]: data.has_more },
        }));
      }
    },

    async selectConversation(conversationId) {
      set((state) => ({
        activeConversationId: conversationId,
        activeChannelId: null,
        unreadBadges: { ...state.unreadBadges, [conversationId]: 0 },
      }));
      get().markChannelRead(conversationId);
      if (!get().dmMessages[conversationId]) {
        const data = await api<{ messages: DmMessageDto[]; has_more: boolean }>(
          `/api/dm/conversations/${conversationId}/messages?limit=50`,
        );
        set((state) => ({
          dmMessages: { ...state.dmMessages, [conversationId]: data.messages },
          dmHasMore: { ...state.dmHasMore, [conversationId]: data.has_more },
        }));
      }
    },

    async loadOlderMessages(channelId) {
      const list = get().messagesByChannel[channelId] ?? [];
      const oldest = list[0]?.created_at;
      if (!oldest) return;
      const data = await api<{ messages: MessageDto[]; has_more: boolean }>(
        `/api/channels/${channelId}/messages?limit=50&before=${encodeURIComponent(oldest)}`,
      );
      set((state) => ({
        messagesByChannel: { ...state.messagesByChannel, [channelId]: [...data.messages, ...(state.messagesByChannel[channelId] ?? [])] },
        hasMoreByChannel: { ...state.hasMoreByChannel, [channelId]: data.has_more },
      }));
    },

    async loadOlderDmMessages(conversationId) {
      const list = get().dmMessages[conversationId] ?? [];
      const oldest = list[0]?.created_at;
      if (!oldest) return;
      const data = await api<{ messages: DmMessageDto[]; has_more: boolean }>(
        `/api/dm/conversations/${conversationId}/messages?limit=50&before=${encodeURIComponent(oldest)}`,
      );
      set((state) => ({
        dmMessages: { ...state.dmMessages, [conversationId]: [...data.messages, ...(state.dmMessages[conversationId] ?? [])] },
        dmHasMore: { ...state.dmHasMore, [conversationId]: data.has_more },
      }));
    },

    markChannelRead(contextKey) {
      const map = readLastReadMap();
      map[contextKey] = new Date().toISOString();
      writeLastReadMap(map);
      set((state) => ({ unreadBadges: { ...state.unreadBadges, [contextKey]: 0 } }));
    },

    async refreshVoiceSessions() {
      const { sessions } = await api<{ sessions: VoiceSessionDto[] }>('/api/voice/sessions');
      set({ voiceSessions: sessions });
    },

    async refreshNotifications() {
      const { notifications } = await api<{ notifications: NotificationDto[] }>('/api/notifications?limit=30');
      set({ notifications });
    },

    async refreshFriends() {
      const friends = await api<FriendsPayload>('/api/friends');
      set({ friends });
    },

    async refreshConversations() {
      const { conversations } = await api<{ conversations: ConversationDto[] }>('/api/dm/conversations');
      set({ conversations });
    },

    async refreshRadio() {
      const radio = await api<{ enabled: boolean; stations: RadioStationDto[] }>('/api/radio/stations');
      set({ radioEnabled: radio.enabled, radioStations: radio.stations });
    },
  };
});

// ---------------------------------------------------------------------------
// Module-level helpers used by both the store and the realtime dispatcher
// ---------------------------------------------------------------------------

function joinCurrentRooms(): void {
  const { servers, activeChannelId } = useDataStore.getState();
  for (const server of servers) {
    emitSocket('server:join', server.id);
  }
  if (activeChannelId) emitSocket('channel:join', activeChannelId);
}

function applyVoiceUpdate(payload: {
  channel_id: string;
  session?: VoiceSessionDto;
  user_id?: string;
  removed?: boolean;
}): void {
  useDataStore.setState((state) => {
    const others = state.voiceSessions.filter(
      (s) =>
        !(
          s.channel_id === payload.channel_id &&
          (payload.removed ? s.user_id === payload.user_id : s.user_id === payload.session?.user_id)
        ),
    );
    const next = payload.removed || !payload.session ? others : [...others, payload.session];
    return { voiceSessions: next };
  });
}

function handleTyping(kind: 'typing' | 'dmTyping', key: string, userId: string): void {
  useDataStore.setState((state) => {
    const map = kind === 'typing' ? state.typing : state.dmTyping;
    const current = [...new Set([...(map[key] ?? []), userId])];
    return kind === 'typing'
      ? { typing: { ...state.typing, [key]: current } }
      : { dmTyping: { ...state.dmTyping, [key]: current } };
  });
  setTimeout(() => {
    useDataStore.setState((state) => {
      const map = kind === 'typing' ? state.typing : state.dmTyping;
      const current = (map[key] ?? []).filter((id) => id !== userId);
      return kind === 'typing'
        ? { typing: { ...state.typing, [key]: current } }
        : { dmTyping: { ...state.dmTyping, [key]: current } };
    });
  }, 6000);
}

function bumpUnread(contextKey: string, createdAt: string): void {
  const state = useDataStore.getState();
  const lastRead = readLastReadMap()[contextKey];
  const isContextKey = contextKey === state.activeChannelId || contextKey === state.activeConversationId;
  if (!isContextKey && (!lastRead || new Date(createdAt) > new Date(lastRead))) {
    useDataStore.setState((s) => ({
      unreadBadges: { ...s.unreadBadges, [contextKey]: (s.unreadBadges[contextKey] ?? 0) + 1 },
    }));
  }
}

// ---------------------------------------------------------------------------
// Realtime dispatch (wired from lib/socket.ts)
// ---------------------------------------------------------------------------

type RealtimePayload = Record<string, unknown>;

export function handleRealtimeEvent(event: string, payload: unknown): void {
  const data = payload as RealtimePayload;
  const store = useDataStore.getState();

  switch (event) {
    case 'presence:update': {
      const ids = (data.user_ids as string[]) ?? [];
      setPresence(ids);
      break;
    }
    case 'message:new': {
      const message = data as unknown as MessageDto;
      upsertIntoStore(message.channel_id, message);
      bumpUnread(message.channel_id, message.created_at);
      break;
    }
    case 'message:updated': {
      const message = data as unknown as MessageDto;
      upsertIntoStore(message.channel_id, message);
      break;
    }
    case 'message:deleted': {
      const { id, channel_id } = data as { id: string; channel_id: string };
      useDataStore.setState((state) => ({
        messagesByChannel: {
          ...state.messagesByChannel,
          [channel_id]: (state.messagesByChannel[channel_id] ?? []).filter((m) => m.id !== id),
        },
      }));
      break;
    }
    case 'direct_message:new': {
      const message = data as unknown as DmMessageDto;
      upsertDm(message);
      bumpUnread(message.conversation_id, message.created_at);
      void store.refreshConversations();
      break;
    }
    case 'direct_message:updated': {
      upsertDm(data as unknown as DmMessageDto);
      break;
    }
    case 'direct_message:deleted': {
      const { id, conversation_id } = data as { id: string; conversation_id: string };
      useDataStore.setState((state) => ({
        dmMessages: {
          ...state.dmMessages,
          [conversation_id]: (state.dmMessages[conversation_id] ?? []).filter((m) => m.id !== id),
        },
      }));
      break;
    }
    case 'direct_message:conversation_new':
    case 'direct_message:conversation_updated': {
      void store.refreshConversations();
      break;
    }
    case 'typing:update': {
      handleTyping('typing', String(data.channel_id), String(data.user_id));
      break;
    }
    case 'dm:typing': {
      handleTyping('dmTyping', String(data.conversation_id), String(data.user_id));
      break;
    }
    case 'voice:updated': {
      applyVoiceUpdate(data as Parameters<typeof applyVoiceUpdate>[0]);
      break;
    }
    case 'radio:state': {
      const state = data as unknown as RadioStateDto;
      useDataStore.setState((s) => ({ radioStates: { ...s.radioStates, [state.channel_id]: state } }));
      break;
    }
    case 'notification:new': {
      useDataStore.setState((s) => ({ notifications: [data as unknown as NotificationDto, ...s.notifications] }));
      break;
    }
    case 'friends:updated': {
      void store.refreshFriends();
      break;
    }
    case 'server:updated': {
      const serverId = String(data.server_id);
      if (serverId === store.activeServerId) void store.loadServerDetail(serverId);
      break;
    }
    case 'server:member_added':
    case 'server:member_removed': {
      const serverId = String(data.server_id);
      if (serverId === store.activeServerId) void store.loadServerDetail(serverId);
      break;
    }
    case 'server:permissions_changed':
    case 'server:membership_revoked': {
      const serverId = String(data.server_id);
      useDataStore.setState((state) => ({
        servers: state.servers.filter((s) => s.id !== serverId),
        activeServerId: state.activeServerId === serverId ? null : state.activeServerId,
      }));
      if (useDataStore.getState().servers[0]) {
        void store.selectServer(useDataStore.getState().servers[0].id);
      }
      break;
    }
    case 'server:deleted': {
      const serverId = String(data.server_id);
      useDataStore.setState((state) => {
        const servers = state.servers.filter((s) => s.id !== serverId);
        return {
          servers,
          activeServerId: state.activeServerId === serverId ? null : state.activeServerId,
        };
      });
      break;
    }
    default:
      break;
  }
}

function setPresence(ids: string[]): void {
  useDataStore.setState({ presence: Object.fromEntries(ids.map((id) => [id, true as const])) });
}

function upsertIntoStore(channelId: string, message: MessageDto): void {
  useDataStore.setState((state) => {
    const list = state.messagesByChannel[channelId] ?? [];
    if (list.some((m) => m.id === message.id)) {
      return {
        messagesByChannel: {
          ...state.messagesByChannel,
          [channelId]: list.map((m) => (m.id === message.id ? message : m)),
        },
      };
    }
    return { messagesByChannel: { ...state.messagesByChannel, [channelId]: [...list, message] } };
  });
}

function upsertDm(message: DmMessageDto): void {
  useDataStore.setState((state) => {
    const list = state.dmMessages[message.conversation_id] ?? [];
    if (list.some((m) => m.id === message.id)) {
      return {
        dmMessages: {
          ...state.dmMessages,
          [message.conversation_id]: list.map((m) => (m.id === message.id ? message : m)),
        },
      };
    }
    return { dmMessages: { ...state.dmMessages, [message.conversation_id]: [...list, message] } };
  });
}
