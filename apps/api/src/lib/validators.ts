import { z } from 'zod';

/** Object keys issued by POST /api/files/upload — no path traversal possible. */
export const FILE_URL_PATTERN = /^\/api\/files\/[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;

export const MAX_MESSAGE_CONTENT = 8000;
export const MAX_ATTACHMENTS = 10;

export const attachmentInputSchema = z.object({
  url: z.string().regex(FILE_URL_PATTERN, 'Attachment URL must reference /api/files/<key>'),
  name: z.string().min(1).max(256),
  content_type: z.string().min(3).max(128),
  size: z.number().int().min(0).max(52_428_800),
});

export const attachmentsInputSchema = z.array(attachmentInputSchema).max(MAX_ATTACHMENTS);

export function attachmentKeyFromUrl(url: string): string {
  return url.replace(/^\/api\/files\//, '');
}

export function isSafeObjectKey(key: string): boolean {
  return (
    key.length > 0 &&
    key.length <= 250 &&
    !key.includes('..') &&
    !key.startsWith('/') &&
    !key.includes('\\') &&
    /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(key)
  );
}

/** Emoji reactions: any unicode glyph up to 64 chars (UI ships a curated set). */
export const reactionEmojiSchema = z.string().min(1).max(64);

/** Deterministic conversation id: dm_<sortedUserIds>_ — keeps old data valid. */
export function buildConversationId(participantIds: string[]): string {
  return `dm_${[...participantIds].sort().join('_')}_`;
}

export function mentionsFromContent(content: string): { userIds: string[]; everyone: boolean } {
  const everyone = /(^|\s)@everyone(\s|$)/.test(content);
  const usernames = new Set<string>();
  const pattern = /(^|\s)@([a-zA-Z0-9_.-]{3,32})/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    usernames.add(match[2].toLowerCase());
  }
  return { userIds: [...usernames], everyone };
}
