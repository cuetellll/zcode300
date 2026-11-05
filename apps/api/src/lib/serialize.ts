import type {
  Attachment,
  Channel,
  DmReaction,
  DirectMessage,
  Message,
  Reaction,
  Role,
  Server,
  ServerMember,
  User,
  VoiceSession,
} from '@prisma/client';
import type { PublicUser } from '../modules/auth/auth.service';
import { publicUser } from '../modules/auth/auth.service';

type Userish = Pick<
  User,
  'id' | 'username' | 'displayName' | 'avatarUrl' | 'avatarColor' | 'bannerColor' | 'status' | 'customStatus' | 'bio' | 'createdAt'
>;

export function serializeUser(user: Userish): PublicUser {
  return publicUser(user as User);
}

export interface SerializedAttachment {
  id: string;
  url: string;
  name: string;
  content_type: string;
  size: number;
}

export function serializeAttachment(a: Attachment): SerializedAttachment {
  const reference = a.fileReference.startsWith('/api/files/')
    ? a.fileReference
    : `/api/files/${a.fileReference}`;
  return {
    id: a.id,
    url: reference,
    name: a.fileName,
    content_type: a.contentType,
    size: a.fileSize,
  };
}

export type ReactionMap = Record<string, string[]>;

export function buildReactionMap(
  reactions: Array<Pick<Reaction, 'emoji' | 'userId'>> | Array<Pick<DmReaction, 'emoji' | 'userId'>>,
): ReactionMap {
  const map: ReactionMap = {};
  for (const reaction of reactions) {
    (map[reaction.emoji] ??= []).push(reaction.userId);
  }
  return map;
}

export interface SerializedMessage {
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
  attachments: SerializedAttachment[];
  reactions: ReactionMap;
}

export function serializeMessage(
  message: Message & {
    author: Userish;
    attachments: Attachment[];
    reactions: Array<Pick<Reaction, 'emoji' | 'userId'>>;
  },
): SerializedMessage {
  return {
    id: message.id,
    channel_id: message.channelId,
    user_id: message.userId,
    content: message.content,
    reply_to_id: message.replyToId,
    pinned: message.pinned,
    edited: message.edited,
    created_at: message.createdAt.toISOString(),
    updated_at: message.updatedAt.toISOString(),
    author: serializeUser(message.author),
    attachments: message.attachments.map(serializeAttachment),
    reactions: buildReactionMap(message.reactions),
  };
}

export interface SerializedDmMessage {
  id: string;
  conversation_id: string;
  user_id: string;
  content: string;
  reply_to_id: string | null;
  pinned: boolean;
  edited: boolean;
  created_at: string;
  updated_at: string;
  author: PublicUser;
  attachments: SerializedAttachment[];
  reactions: ReactionMap;
}

export function serializeDmMessage(
  message: DirectMessage & {
    author: Userish;
    attachments: Attachment[];
    reactions: Array<Pick<DmReaction, 'emoji' | 'userId'>>;
  },
): SerializedDmMessage {
  return {
    id: message.id,
    conversation_id: message.conversationId,
    user_id: message.senderId,
    content: message.content,
    reply_to_id: message.replyToId,
    pinned: message.pinned,
    edited: message.edited,
    created_at: message.createdAt.toISOString(),
    updated_at: message.updatedAt.toISOString(),
    author: serializeUser(message.author),
    attachments: message.attachments.map(serializeAttachment),
    reactions: buildReactionMap(message.reactions),
  };
}

export function serializeServer(server: Server): Record<string, unknown> {
  return {
    id: server.id,
    name: server.name,
    description: server.description,
    icon_url: server.iconUrl,
    icon_text: server.iconText,
    icon_color: server.iconColor,
    owner_id: server.ownerId,
    invite_code: server.inviteCode,
    created_at: server.createdAt.toISOString(),
  };
}

export function serializeChannel(channel: Channel): Record<string, unknown> {
  return {
    id: channel.id,
    server_id: channel.serverId,
    name: channel.name,
    category: channel.category,
    type: channel.type,
    topic: channel.topic,
    position: channel.position,
    slowmode: channel.slowmode,
    is_private: channel.isPrivate,
    created_at: channel.createdAt.toISOString(),
  };
}

export function serializeRole(role: Role & { permissions?: Array<{ node: string }> }): Record<string, unknown> {
  return {
    id: role.id,
    server_id: role.serverId,
    name: role.name,
    color: role.color,
    position: role.position,
    hoist: role.hoist,
    permissions: role.permissions?.map((p) => p.node) ?? undefined,
  };
}

export function serializeMember(
  member: ServerMember & { user: Userish; roles?: Array<Role & { permissions?: Array<{ node: string }> }> },
): Record<string, unknown> {
  return {
    id: member.id,
    server_id: member.serverId,
    user: serializeUser(member.user),
    user_id: member.userId,
    nickname: member.nickname,
    joined_at: member.joinedAt.toISOString(),
    role_ids: member.roles?.map((r) => r.id) ?? [],
  };
}

export function serializeVoiceSession(session: VoiceSession & { user: Userish }): Record<string, unknown> {
  return {
    id: session.id,
    channel_id: session.channelId,
    user_id: session.userId,
    muted: session.muted,
    deafened: session.deafened,
    video_enabled: session.videoEnabled,
    screen_sharing: session.screenSharing,
    joined_at: session.joinedAt.toISOString(),
    user: serializeUser(session.user),
  };
}
