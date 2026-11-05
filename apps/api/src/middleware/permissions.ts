import type { Channel, Server, ServerMember } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { forbidden, notFound } from '../lib/errors';

export interface MemberContext {
  member: ServerMember;
  isOwner: boolean;
  nodes: Set<string>;
}

/** Load membership + effective permission nodes (owner bypasses everything). */
export async function getMemberContext(userId: string, serverId: string): Promise<MemberContext> {
  const server = await prisma.server.findUnique({ where: { id: serverId } });
  if (!server) throw notFound('Server not found');
  if (server.ownerId === userId) {
    return { member: { id: 'owner', serverId, userId, nickname: null, joinedAt: new Date() }, isOwner: true, nodes: new Set(['ADMINISTRATOR']) };
  }
  const member = await prisma.serverMember.findUnique({
    where: { serverId_userId: { serverId, userId } },
    include: { roles: { include: { permissions: true } } },
  });
  if (!member) throw notFound('You are not a member of this server');
  const nodes = new Set<string>();
  const everyoneRole = await prisma.role.findFirst({
    where: { serverId, name: '@everyone' },
    include: { permissions: true },
  });
  for (const node of everyoneRole?.permissions ?? []) nodes.add(node.node);
  for (const role of member.roles) {
    for (const node of role.permissions) nodes.add(node.node);
  }
  return { member, isOwner: false, nodes };
}

export function memberHasPermission(context: MemberContext, node: string): boolean {
  if (context.isOwner || context.nodes.has('ADMINISTRATOR')) return true;
  return context.nodes.has(node);
}

export async function serverPermission(userId: string, serverId: string, node: string): Promise<boolean> {
  const context = await getMemberContext(userId, serverId);
  return memberHasPermission(context, node);
}

export async function requireServerPermission(userId: string, serverId: string, node: string): Promise<MemberContext> {
  const context = await getMemberContext(userId, serverId);
  if (!memberHasPermission(context, node)) {
    throw forbidden(`Missing server permission: ${node}`);
  }
  return context;
}

/** Channel visibility: VIEW_CHANNELS + private grant (owner/MANAGE bypass). */
export async function canAccessChannel(userId: string, channel: Channel): Promise<boolean> {
  let context: MemberContext;
  try {
    context = await getMemberContext(userId, channel.serverId);
  } catch {
    return false;
  }
  if (!memberHasPermission(context, 'VIEW_CHANNELS')) return false;
  if (!channel.isPrivate) return true;
  if (memberHasPermission(context, 'MANAGE_CHANNELS')) return true;
  const grant = await prisma.channelAccess.findUnique({
    where: { channelId_userId: { channelId: channel.id, userId } },
  });
  return Boolean(grant);
}

export async function requireChannelAccess(userId: string, channelId: string): Promise<Channel> {
  const channel = await prisma.channel.findUnique({ where: { id: channelId } });
  if (!channel) throw notFound('Channel not found');
  if (!(await canAccessChannel(userId, channel))) throw forbidden('No access to this channel');
  return channel;
}

export async function getServerForUser(userId: string, serverId: string): Promise<Server> {
  const server = await prisma.server.findUnique({ where: { id: serverId } });
  if (!server) throw notFound('Server not found');
  const member = await prisma.serverMember.findUnique({
    where: { serverId_userId: { serverId, userId } },
  });
  const isOwner = server.ownerId === userId;
  if (!member && !isOwner) throw forbidden('You are not a member of this server');
  return server;
}
