/**
 * Server permission nodes. This is the complete catalog — every role
 * permission row must reference one of these strings.
 */
export const PERMISSION_NODES = [
  'ADMINISTRATOR',
  'MANAGE_SERVER',
  'MANAGE_ROLES',
  'MANAGE_CHANNELS',
  'KICK_MEMBERS',
  'BAN_MEMBERS',
  'MANAGE_MESSAGES',
  'SEND_MESSAGES',
  'CONNECT_VOICE',
  'SPEAK_VOICE',
  'STREAM_VIDEO',
  'VIEW_CHANNELS',
  'VIEW_AUDIT_LOG',
  'MOVE_MEMBERS',
] as const;

export type PermissionNode = (typeof PERMISSION_NODES)[number];

/** Nodes so powerful that only the server owner may grant/hold them. */
export const OWNER_ONLY_NODES: ReadonlySet<string> = new Set([
  'ADMINISTRATOR',
  'MANAGE_SERVER',
  'MANAGE_ROLES',
]);

export const DEFAULT_EVERYONE_PERMISSIONS: PermissionNode[] = [
  'VIEW_CHANNELS',
  'SEND_MESSAGES',
  'CONNECT_VOICE',
  'SPEAK_VOICE',
  'STREAM_VIDEO',
];

export function isPermissionNode(node: string): node is PermissionNode {
  return (PERMISSION_NODES as readonly string[]).includes(node);
}
