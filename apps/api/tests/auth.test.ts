import { describe, expect, it } from 'vitest';
import { signAccessToken, verifyAccessToken } from '../src/modules/auth/auth.service';
import { validateAvatarDataUrl } from '../src/lib/avatar';
import { FILE_URL_PATTERN, attachmentKeyFromUrl, mentionsFromContent, isSafeObjectKey } from '../src/lib/validators';
import { buildConversationId } from '../src/lib/validators';
import { buildReactionMap } from '../src/lib/serialize';

describe('access tokens', () => {
  it('round-trips the user id', () => {
    const token = signAccessToken('user-123');
    expect(verifyAccessToken(token)).toBe('user-123');
  });

  it('rejects tampered tokens', () => {
    const token = signAccessToken('user-123');
    expect(() => verifyAccessToken(`${token}x`)).toThrow();
  });
});

describe('avatar validation', () => {
  // 1x1 transparent PNG
  const pngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

  it('accepts a small PNG data URL', () => {
    const result = validateAvatarDataUrl(`data:image/png;base64,${pngBase64}`);
    expect(result).toBe(`data:image/png;base64,${pngBase64}`);
  });

  it('rejects non-image payloads', () => {
    expect(() => validateAvatarDataUrl('data:text/html;base64,PGI+aGk8L2I+')).toThrow();
    expect(() => validateAvatarDataUrl('https://example.com/avatar.png')).toThrow();
    expect(() => validateAvatarDataUrl(null)).toBeNull();
  });
});

describe('attachment validators', () => {
  it('accepts valid /api/files/ keys', () => {
    expect(FILE_URL_PATTERN.test('/api/files/2025-01-01/abc-file.png')).toBe(true);
    expect(FILE_URL_PATTERN.test('https://evil.example/x.png')).toBe(false);
    expect(FILE_URL_PATTERN.test('/api/files/..%2f..%2fetc')).toBe(false);
  });

  it('extracts object keys and rejects traversal', () => {
    expect(attachmentKeyFromUrl('/api/files/day/uuid-name.png')).toBe('day/uuid-name.png');
    expect(isSafeObjectKey('day/uuid-name.png')).toBe(true);
    expect(isSafeObjectKey('a/../etc-passwd')).toBe(false);
    expect(isSafeObjectKey('/absolute/path')).toBe(false);
  });
});

describe('mentions', () => {
  it('parses @username and @everyone', () => {
    const parsed = mentionsFromContent('hi @mahyar01 and @everyone!');
    expect(parsed.everyone).toBe(true);
    expect(parsed.userIds).toEqual(['mahyar01']);
  });

  it('ignores mid-word @', () => {
    const parsed = mentionsFromContent('contact foo@bar');
    expect(parsed.userIds).toEqual([]);
    expect(parsed.everyone).toBe(false);
  });
});

describe('conversations', () => {
  it('builds a deterministic conversation id independent of order', () => {
    expect(buildConversationId(['b', 'a'])).toBe(buildConversationId(['a', 'b']));
    expect(buildConversationId(['a', 'b'])).toBe('dm_a_b_');
  });
});

describe('reaction maps', () => {
  it('groups reactions by emoji preserving order', () => {
    const map = buildReactionMap([
      { emoji: '🚀', userId: 'u1' },
      { emoji: '🔥', userId: 'u2' },
      { emoji: '🚀', userId: 'u3' },
    ]);
    expect(map).toEqual({ '🚀': ['u1', 'u3'], '🔥': ['u2'] });
  });
});
