// Shared API payload types (snake_case as the server emits them).

export type UserStatus = 'ONLINE' | 'IDLE' | 'DND' | 'OFFLINE';

export interface PublicUser {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  avatar_color: string;
  banner_color: string;
  status: UserStatus;
  custom_status: string | null;
  bio: string | null;
  created_at: string;
}

export interface ChannelDto {
  id: string;
  server_id: string;
  name: string;
  category: string;
  type: 'TEXT' | 'VOICE';
  topic: string | null;
  position: number;
  slowmode: number;
  is_private: boolean;
}

export interface ServerDto {
  id: string;
  name: string;
  description: string | null;
  icon_url: string | null;
  icon_text: string;
  icon_color: string;
  owner_id: string;
  invite_code: string;
  channels?: ChannelDto[];
  owner?: boolean;
}

export interface AttachmentDto {
  id: string;
  url: string;
  name: string;
  content_type: string;
  size: number;
}

export interface MessageDto {
  id: string;
  channel_id: string;
  user_id: string;
  content: string;
  reply_to_id: string | null;
  pinned: boolean;
  edited: boolean;
  created_at: string;
  updated_at: string;
  author: PublicUser;
  attachments: AttachmentDto[];
  reactions: Record<string, string[]>;
}

export interface DmMessageDto extends Omit<MessageDto, 'channel_id'> {
  conversation_id: string;
}

export interface ConversationDto {
  conversation_id: string;
  participant_ids: string[];
  participants: PublicUser[];
  is_group: boolean;
  group_name: string | null;
  last_message_at: string | null;
}

export interface RoleDto {
  id: string;
  server_id: string;
  name: string;
  color: string;
  position: number;
  hoist: boolean;
  permissions?: string[];
}

export interface MemberDto {
  id: string;
  server_id: string;
  user: PublicUser;
  user_id: string;
  nickname: string | null;
  joined_at: string;
  role_ids: string[];
}

export interface VoiceSessionDto {
  id: string;
  channel_id: string;
  user_id: string;
  muted: boolean;
  deafened: boolean;
  video_enabled: boolean;
  screen_sharing: boolean;
  joined_at: string;
  user: PublicUser;
}

export interface NotificationDto {
  id: string;
  title: string;
  body: string;
  type: string;
  read: boolean;
  created_at: string;
}

export interface RadioStateDto {
  channel_id: string;
  server_id?: string;
  status: 'starting' | 'live' | 'error' | 'stopped' | 'stopping';
  station_id: string | null;
  station_title: string | null;
  listeners: number;
  error: string | null;
}

export interface RadioStationDto {
  id: string;
  title: string;
  description: string;
}

export interface FriendsPayload {
  friends: Array<{ user: PublicUser; since: string }>;
  incoming_requests: Array<{ request_id: string; user: PublicUser }>;
  outgoing_requests: Array<{ request_id: string; user: PublicUser }>;
  blocked: Array<{ user: PublicUser }>;
}

export interface VoiceTokenResponse {
  url: string;
  token: string;
  room: string;
  identity: string;
  permissions: { can_speak: boolean; can_stream: boolean };
}

export interface InvitePreview {
  code: string;
  server: { id: string; name: string; icon_text: string; icon_color: string; member_count: number; channel_count: number };
}
