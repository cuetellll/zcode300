import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, badRequest, forbidden, HttpError, notFound } from '../../lib/errors';
import { requireAuth, getUserId } from '../../middleware/auth';
import { getMemberContext, memberHasPermission, requireServerPermission } from '../../middleware/permissions';
import { serializeMember, serializeRole, serializeServer } from '../../lib/serialize';
import { isPermissionNode, OWNER_ONLY_NODES } from '../../config/permissions';
import { emitToServer, emitToUser } from '../../realtime/socket-bus';
import { revokeMembership, createServerWithDefaults, generateInviteCode, writeAudit } from './servers.service';

export const serversRouter = Router();
export const invitesRouter = Router();

const nameSchema = z.string().min(1).max(100);
const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

// ---------------------------------------------------------------------------
// Servers
// ---------------------------------------------------------------------------

const createServerSchema = z.object({ name: nameSchema });

serversRouter.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const body = createServerSchema.parse(req.body);
    const created = await createServerWithDefaults(userId, body.name);
    const server = await prisma.server.findUnique({ where: { id: created.serverId } });
    res.status(201).json({ server: server ? serializeServer(server) : null });
  }),
);

serversRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const memberships = await prisma.serverMember.findMany({
      where: { userId },
      include: { server: { include: { channels: { orderBy: [{ category: 'asc' }, { position: 'asc' }, { name: 'asc' }] } } } },
    });
    res.json({
      servers: memberships.map((m) => ({
        ...serializeServer(m.server),
        channels: m.server.channels.map((c) => ({
          id: c.id,
          name: c.name,
          type: c.type,
          category: c.category,
          topic: c.topic,
          position: c.position,
          slowmode: c.slowmode,
          is_private: c.isPrivate,
        })),
        owner: m.server.ownerId === userId,
      })),
    });
  }),
);

async function loadServerBootstrap(serverId: string, userId: string) {
  const server = await prisma.server.findUnique({ where: { id: serverId } });
  if (!server) throw notFound('Server not found');
  const membership = await prisma.serverMember.findUnique({
    where: { serverId_userId: { serverId, userId } },
  });
  if (!membership && server.ownerId !== userId) throw forbidden('You are not a member of this server');
  return server;
}

serversRouter.get(
  '/:serverId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const server = await loadServerBootstrap(req.params.serverId, userId);
    const [members, roles, bans, channels] = await Promise.all([
      prisma.serverMember.findMany({
        where: { serverId: server.id },
        include: { user: true, roles: { include: { permissions: true } } },
        orderBy: { joinedAt: 'asc' },
      }),
      prisma.role.findMany({
        where: { serverId: server.id },
        include: { permissions: true },
        orderBy: { position: 'desc' },
      }),
      getMemberContext(userId, server.id).then((ctx) =>
        memberHasPermission(ctx, 'BAN_MEMBERS')
          ? prisma.ban.findMany({ where: { serverId: server.id } })
          : [],
      ),
      prisma.channel.findMany({
        where: { serverId: server.id },
        orderBy: [{ category: 'asc' }, { position: 'asc' }, { name: 'asc' }],
      }),
    ]);
    res.json({
      server: {
        ...serializeServer(server),
        channels: channels.map((c) => ({
          id: c.id,
          name: c.name,
          type: c.type,
          category: c.category,
          topic: c.topic,
          position: c.position,
          slowmode: c.slowmode,
          is_private: c.isPrivate,
        })),
      },
      members: members.map(serializeMember),
      roles: roles.map((role) => serializeRole(role)),
      bans: bans.map((ban) => ({ user_id: ban.userId, reason: ban.reason, created_at: ban.createdAt.toISOString() })),
      me: { is_owner: server.ownerId === userId },
    });
  }),
);

const updateServerSchema = z.object({
  name: nameSchema.optional(),
  description: z.string().max(500).optional().nullable(),
  icon_color: colorSchema.optional(),
  icon_text: z.string().min(1).max(2).optional(),
});

serversRouter.patch(
  '/:serverId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    await requireServerPermission(userId, req.params.serverId, 'MANAGE_SERVER');
    const body = updateServerSchema.parse(req.body);
    const server = await prisma.server.update({
      where: { id: req.params.serverId },
      data: {
        ...(body.name !== undefined ? { name: body.name.trim(), iconText: body.name.trim().slice(0, 2).toUpperCase() } : {}),
        ...(body.description !== undefined ? { description: body.description?.trim() || null } : {}),
        ...(body.icon_color !== undefined ? { iconColor: body.icon_color } : {}),
        ...(body.icon_text !== undefined ? { iconText: body.icon_text } : {}),
      },
    });
    await writeAudit(server.id, userId, 'SERVER_UPDATE', server.name);
    emitToServer(server.id, 'server:updated', { server_id: server.id });
    res.json({ server: serializeServer(server) });
  }),
);

serversRouter.delete(
  '/:serverId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const server = await prisma.server.findUnique({ where: { id: req.params.serverId } });
    if (!server) throw notFound('Server not found');
    if (server.ownerId !== userId) throw forbidden('Only the owner can delete the server');
    const channels = await prisma.channel.findMany({ where: { serverId: server.id }, select: { id: true } });
    const members = await prisma.serverMember.findMany({ where: { serverId: server.id }, select: { userId: true } });
    await prisma.server.delete({ where: { id: server.id } });
    emitToServer(server.id, 'server:deleted', { server_id: server.id });
    const { forceLeaveServerRooms } = await import('../../realtime/socket-bus');
    for (const member of members) forceLeaveServerRooms(member.userId, server.id, channels.map((c) => c.id));
    res.status(204).end();
  }),
);

serversRouter.post(
  '/:serverId/leave',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const server = await prisma.server.findUnique({ where: { id: req.params.serverId } });
    if (!server) throw notFound('Server not found');
    if (server.ownerId === userId) {
      throw forbidden('The owner cannot leave their own server — delete it or transfer ownership first');
    }
    const membership = await prisma.serverMember.findUnique({
      where: { serverId_userId: { serverId: server.id, userId } },
    });
    if (!membership) throw notFound('You are not a member of this server');
    await prisma.serverMember.delete({ where: { id: membership.id } });
    await writeAudit(server.id, userId, 'MEMBER_LEAVE');
    await revokeMembership(server.id, userId, 'left');
    res.status(204).end();
  }),
);

// ---------------------------------------------------------------------------
// Join & invites
// ---------------------------------------------------------------------------

const joinSchema = z.object({ code: z.string().min(3).max(64) });

serversRouter.post(
  '/join',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const body = joinSchema.parse(req.body);
    const code = body.code.trim();

    const server = await prisma.server.findUnique({ where: { inviteCode: code } });
    const invitation = server ? null : await prisma.invitation.findUnique({ where: { code } });
    if (invitation) {
      if (invitation.expiresAt && invitation.expiresAt.getTime() < Date.now()) {
        throw new HttpError(410, 'This invite has expired');
      }
      if (invitation.maxUses !== null && invitation.uses >= invitation.maxUses) {
        throw new HttpError(410, 'This invite has reached its usage limit');
      }
    }
    const targetServerId = server?.id ?? invitation?.serverId;
    if (!targetServerId) throw notFound('Invalid invite code');

    const banned = await prisma.ban.findUnique({ where: { serverId_userId: { serverId: targetServerId, userId } } });
    if (banned) throw forbidden('You are banned from this server');

    const serverId = targetServerId;
    await prisma.serverMember.upsert({
      where: { serverId_userId: { serverId, userId } },
      update: {},
      create: { serverId, userId },
    });
    if (invitation) {
      await prisma.invitation.update({ where: { id: invitation.id }, data: { uses: { increment: 1 } } });
    }
    await writeAudit(serverId, userId, 'MEMBER_JOIN');
    emitToServer(serverId, 'server:member_added', { server_id: serverId, user_id: userId });
    const joined = await prisma.server.findUnique({ where: { id: serverId } });
    res.status(200).json({ server: joined ? serializeServer(joined) : null });
  }),
);

const createInviteSchema = z.object({
  max_uses: z.number().int().min(1).max(500).optional().nullable(),
  expires_in_hours: z.number().min(0.5).max(168).optional().nullable(),
});

serversRouter.post(
  '/:serverId/invites',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    await requireServerPermission(userId, req.params.serverId, 'MANAGE_SERVER');
    const body = createInviteSchema.parse(req.body ?? {});
    const invitation = await prisma.invitation.create({
      data: {
        serverId: req.params.serverId,
        code: generateInviteCode(),
        maxUses: body.max_uses ?? null,
        expiresAt: body.expires_in_hours ? new Date(Date.now() + body.expires_in_hours * 3_600_000) : null,
      },
    });
    await writeAudit(req.params.serverId, userId, 'INVITE_CREATE', invitation.code);
    res.status(201).json({
      invitation: {
        id: invitation.id,
        code: invitation.code,
        max_uses: invitation.maxUses,
        uses: invitation.uses,
        expires_at: invitation.expiresAt?.toISOString() ?? null,
      },
    });
  }),
);

serversRouter.get(
  '/:serverId/invites',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    await requireServerPermission(userId, req.params.serverId, 'MANAGE_SERVER');
    const invitations = await prisma.invitation.findMany({
      where: { serverId: req.params.serverId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({
      invitations: invitations.map((i) => ({
        id: i.id,
        code: i.code,
        uses: i.uses,
        max_uses: i.maxUses,
        expires_at: i.expiresAt?.toISOString() ?? null,
        created_at: i.createdAt.toISOString(),
      })),
    });
  }),
);

invitesRouter.get(
  '/:code',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const code = req.params.code;
    const server = await prisma.server.findUnique({ where: { inviteCode: code } });
    const invitation = server ? null : await prisma.invitation.findUnique({ where: { code } });
    const serverId = server?.id ?? invitation?.serverId;
    if (!serverId) throw notFound('Invalid invite code');
    const banned = await prisma.ban.findUnique({ where: { serverId_userId: { serverId, userId } } });
    if (banned) throw forbidden('You are banned from this server');
    if (invitation) {
      if (invitation.expiresAt && invitation.expiresAt.getTime() < Date.now()) throw new HttpError(410, 'This invite has expired');
      if (invitation.maxUses !== null && invitation.uses >= invitation.maxUses) {
        throw new HttpError(410, 'This invite has reached its usage limit');
      }
    }
    const target = await prisma.server.findUnique({
      where: { id: serverId },
      include: { members: true, channels: true },
    });
    if (!target) throw notFound('Invalid invite code');
    res.json({
      invite: {
        code,
        server: {
          id: target.id,
          name: target.name,
          icon_text: target.iconText,
          icon_color: target.iconColor,
          member_count: target.members.length,
          channel_count: target.channels.length,
        },
      },
    });
  }),
);

invitesRouter.delete(
  '/:inviteId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const invitation = await prisma.invitation.findUnique({ where: { id: req.params.inviteId } });
    if (!invitation) throw notFound('Invite not found');
    await requireServerPermission(userId, invitation.serverId, 'MANAGE_SERVER');
    await prisma.invitation.delete({ where: { id: invitation.id } });
    await writeAudit(invitation.serverId, userId, 'INVITE_REVOKE', invitation.code);
    res.status(204).end();
  }),
);

// ---------------------------------------------------------------------------
// Members, roles, bans, audit log
// ---------------------------------------------------------------------------

serversRouter.get(
  '/:serverId/members',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    await loadServerBootstrap(req.params.serverId, userId);
    const members = await prisma.serverMember.findMany({
      where: { serverId: req.params.serverId },
      include: { user: true, roles: { include: { permissions: true } } },
      orderBy: { joinedAt: 'asc' },
    });
    res.json({ members: members.map(serializeMember) });
  }),
);

const updateMemberSchema = z.object({
  nickname: z.string().max(64).optional().nullable(),
  role_ids: z.array(z.string().min(1).max(64)).max(20).optional(),
});

serversRouter.patch(
  '/:serverId/members/:memberId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const ctx = await requireServerPermission(userId, req.params.serverId, 'MANAGE_ROLES');
    const body = updateMemberSchema.parse(req.body ?? {});
    const target = await prisma.serverMember.findUnique({
      where: { id: req.params.memberId },
      include: { user: true },
    });
    if (!target || target.serverId !== req.params.serverId) throw notFound('Member not found');
    const server = await prisma.server.findUnique({ where: { id: req.params.serverId } });
    if (!server) throw notFound('Server not found');
    if (target.userId === server.ownerId && target.userId !== userId) {
      throw forbidden('The owner cannot be modified');
    }

    let roleIds: string[] | undefined;
    if (body.role_ids !== undefined) {
      const roles = await prisma.role.findMany({
        where: { serverId: server.id, id: { in: body.role_ids }, name: { not: '@everyone' } },
        include: { permissions: true },
      });
      if (!ctx.isOwner) {
        for (const role of roles) {
          for (const permission of role.permissions) {
            if (OWNER_ONLY_NODES.has(permission.node)) {
              throw forbidden(`Only the owner can grant the ${permission.node} permission`);
            }
          }
        }
      }
      roleIds = roles.map((role) => role.id);
    }

    const updated = await prisma.serverMember.update({
      where: { id: target.id },
      data: {
        ...(body.nickname !== undefined ? { nickname: body.nickname?.trim() || null } : {}),
        ...(roleIds ? { roles: { set: roleIds.map((id) => ({ id })) } } : {}),
      },
      include: { user: true, roles: { include: { permissions: true } } },
    });
    await writeAudit(server.id, userId, 'MEMBER_UPDATE', target.user.username);
    emitToUser(target.userId, 'server:permissions_changed', { server_id: server.id });
    res.json({ member: serializeMember(updated) });
  }),
);

serversRouter.delete(
  '/:serverId/members/:memberId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    await requireServerPermission(userId, req.params.serverId, 'KICK_MEMBERS');
    const target = await prisma.serverMember.findUnique({ where: { id: req.params.memberId }, include: { user: true } });
    if (!target || target.serverId !== req.params.serverId) throw notFound('Member not found');
    const server = await prisma.server.findUnique({ where: { id: req.params.serverId } });
    if (!server) throw notFound('Server not found');
    if (target.userId === server.ownerId) throw forbidden('The owner cannot be kicked');
    await prisma.serverMember.delete({ where: { id: target.id } });
    await writeAudit(server.id, userId, 'MEMBER_KICK', target.user.username);
    await revokeMembership(server.id, target.userId, 'kicked');
    res.status(204).end();
  }),
);

const banSchema = z.object({ user_id: z.string().min(1).max(64), reason: z.string().max(500).optional() });

serversRouter.post(
  '/:serverId/bans',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    await requireServerPermission(userId, req.params.serverId, 'BAN_MEMBERS');
    const body = banSchema.parse(req.body);
    const server = await prisma.server.findUnique({ where: { id: req.params.serverId } });
    if (!server) throw notFound('Server not found');
    if (body.user_id === server.ownerId) throw forbidden('The owner cannot be banned');
    const target = await prisma.user.findUnique({ where: { id: body.user_id } });
    if (!target) throw notFound('User not found');
    await prisma.$transaction([
      prisma.serverMember.deleteMany({ where: { serverId: server.id, userId: body.user_id } }),
      prisma.ban.upsert({
        where: { serverId_userId: { serverId: server.id, userId: body.user_id } },
        update: { reason: body.reason ?? null },
        create: { serverId: server.id, userId: body.user_id, reason: body.reason ?? null },
      }),
    ]);
    await writeAudit(server.id, userId, 'MEMBER_BAN', target.username, body.reason);
    await revokeMembership(server.id, body.user_id, 'banned');
    res.status(201).json({ banned: true });
  }),
);

serversRouter.get(
  '/:serverId/bans',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    await requireServerPermission(userId, req.params.serverId, 'BAN_MEMBERS');
    const bans = await prisma.ban.findMany({
      where: { serverId: req.params.serverId },
      include: { server: true },
    });
    const users = await prisma.user.findMany({ where: { id: { in: bans.map((b) => b.userId) } } });
    const byId = new Map(users.map((u) => [u.id, u]));
    res.json({
      bans: bans.map((ban) => ({
        user_id: ban.userId,
        username: byId.get(ban.userId)?.username ?? null,
        display_name: byId.get(ban.userId)?.displayName ?? null,
        reason: ban.reason,
        created_at: ban.createdAt.toISOString(),
      })),
    });
  }),
);

serversRouter.delete(
  '/:serverId/bans/:userId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    await requireServerPermission(userId, req.params.serverId, 'BAN_MEMBERS');
    await prisma.ban.deleteMany({ where: { serverId: req.params.serverId, userId: req.params.userId } });
    await writeAudit(req.params.serverId, userId, 'MEMBER_UNBAN', req.params.userId);
    res.status(204).end();
  }),
);

const createRoleSchema = z.object({
  name: z.string().min(1).max(64).refine((n) => n !== '@everyone', 'Reserved role name'),
  color: colorSchema.optional(),
  position: z.number().int().min(1).max(100).optional(),
  hoist: z.boolean().optional(),
  permissions: z.array(z.string()).max(20).optional(),
});

async function validateRoleNodes(isOwner: boolean, nodes: string[]): Promise<string[]> {
  for (const node of nodes) {
    if (!isPermissionNode(node)) throw badRequest(`Unknown permission node: ${node}`);
    if (OWNER_ONLY_NODES.has(node) && !isOwner) {
      throw forbidden(`Only the owner can grant the ${node} permission`);
    }
  }
  return nodes;
}

serversRouter.post(
  '/:serverId/roles',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const ctx = await requireServerPermission(userId, req.params.serverId, 'MANAGE_ROLES');
    const body = createRoleSchema.parse(req.body);
    const nodes = body.permissions ? await validateRoleNodes(ctx.isOwner, body.permissions) : [];
    const role = await prisma.role.create({
      data: {
        serverId: req.params.serverId,
        name: body.name,
        color: body.color ?? '#99AAB5',
        position: body.position ?? 1,
        hoist: body.hoist ?? false,
        permissions: { create: nodes.map((node) => ({ node })) },
      },
      include: { permissions: true },
    });
    await writeAudit(req.params.serverId, userId, 'ROLE_CREATE', role.name);
    emitToServer(req.params.serverId, 'server:updated', { server_id: req.params.serverId });
    res.status(201).json({ role: serializeRole(role) });
  }),
);

const updateRoleSchema = createRoleSchema.partial();

serversRouter.patch(
  '/:serverId/roles/:roleId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const ctx = await requireServerPermission(userId, req.params.serverId, 'MANAGE_ROLES');
    const body = updateRoleSchema.parse(req.body);
    const role = await prisma.role.findUnique({ where: { id: req.params.roleId } });
    if (!role || role.serverId !== req.params.serverId) throw notFound('Role not found');
    if (role.name === '@everyone' && (body.name !== undefined || body.permissions !== undefined)) {
      throw forbidden('The @everyone role cannot be renamed or have its permissions replaced');
    }
    const nodes = body.permissions ? await validateRoleNodes(ctx.isOwner, body.permissions) : undefined;
    const updated = await prisma.role.update({
      where: { id: role.id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.color !== undefined ? { color: body.color } : {}),
        ...(body.position !== undefined ? { position: body.position } : {}),
        ...(body.hoist !== undefined ? { hoist: body.hoist } : {}),
        ...(nodes ? { permissions: { deleteMany: {}, create: nodes.map((node) => ({ node })) } } : {}),
      },
      include: { permissions: true },
    });
    await writeAudit(req.params.serverId, userId, 'ROLE_UPDATE', updated.name);
    emitToServer(req.params.serverId, 'server:updated', { server_id: req.params.serverId });
    res.json({ role: serializeRole(updated) });
  }),
);

serversRouter.delete(
  '/:serverId/roles/:roleId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    await requireServerPermission(userId, req.params.serverId, 'MANAGE_ROLES');
    const role = await prisma.role.findUnique({ where: { id: req.params.roleId } });
    if (!role || role.serverId !== req.params.serverId) throw notFound('Role not found');
    if (role.name === '@everyone') throw forbidden('The @everyone role cannot be deleted');
    await prisma.role.delete({ where: { id: role.id } });
    await writeAudit(req.params.serverId, userId, 'ROLE_DELETE', role.name);
    emitToServer(req.params.serverId, 'server:updated', { server_id: req.params.serverId });
    res.status(204).end();
  }),
);

serversRouter.get(
  '/:serverId/audit-logs',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    await requireServerPermission(userId, req.params.serverId, 'VIEW_AUDIT_LOG');
    const logs = await prisma.auditLog.findMany({
      where: { serverId: req.params.serverId },
      include: { actor: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({
      logs: logs.map((log) => ({
        id: log.id,
        actor: { id: log.actor.id, username: log.actor.username, display_name: log.actor.displayName },
        action_type: log.actionType,
        target: log.targetName,
        details: log.details,
        created_at: log.createdAt.toISOString(),
      })),
    });
  }),
);
