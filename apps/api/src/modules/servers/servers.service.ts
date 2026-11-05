import { prisma } from '../../lib/prisma';
import { emitToServer, emitToUser, forceLeaveServerRooms } from '../../realtime/socket-bus';
import { revokeUserFromServerVoice } from '../voice/voice.routes';
import { DEFAULT_EVERYONE_PERMISSIONS } from '../../config/permissions';

/** Append-only server audit trail (server-side only — clients never write). */
export async function writeAudit(
  serverId: string,
  actorId: string,
  actionType: string,
  targetName?: string,
  details?: string,
): Promise<void> {
  await prisma.auditLog
    .create({
      data: { serverId, actorId, actionType, targetName: targetName ?? null, details: details ?? null },
    })
    .catch(() => undefined);
}

export function generateInviteCode(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let code = '';
  for (let i = 0; i < 16; i += 1) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export async function revokeMembership(serverId: string, userId: string, reason: string): Promise<void> {
  const channels = await prisma.channel.findMany({ where: { serverId }, select: { id: true } });
  await prisma.voiceSession.deleteMany({ where: { userId, channel: { serverId } } });
  forceLeaveServerRooms(userId, serverId, channels.map((c) => c.id));
  emitToUser(userId, 'server:membership_revoked', { server_id: serverId, reason });
  emitToServer(serverId, 'server:member_removed', { server_id: serverId, user_id: userId });
  await revokeUserFromServerVoice(serverId, userId).catch(() => undefined);
}

export async function createServerWithDefaults(ownerId: string, name: string): Promise<{ serverId: string; inviteCode: string }> {
  const inviteCode = generateInviteCode();
  const server = await prisma.server.create({
    data: {
      name: name.trim(),
      ownerId,
      inviteCode,
      iconText: name.trim().slice(0, 2).toUpperCase(),
      channels: {
        create: [
          { name: 'general', type: 'TEXT', category: 'TEXT CHANNELS', position: 0 },
          { name: 'General Voice', type: 'VOICE', category: 'VOICE CHANNELS', position: 0 },
        ],
      },
    },
  });
  const everyoneRole = await prisma.role.create({
    data: {
      serverId: server.id,
      name: '@everyone',
      position: 0,
      permissions: { create: DEFAULT_EVERYONE_PERMISSIONS.map((node) => ({ node })) },
    },
  });
  await prisma.serverMember.create({
    data: { serverId: server.id, userId: ownerId, roles: { connect: [{ id: everyoneRole.id }] } },
  });
  await writeAudit(server.id, ownerId, 'SERVER_CREATE', server.name);
  return { serverId: server.id, inviteCode };
}
