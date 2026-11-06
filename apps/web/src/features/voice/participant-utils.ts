import type { MemberDto, PublicUser } from '../../lib/types';
import { hashColor } from '../../components/ui';

/**
 * Voice participants only carry an identity (user id) + display name from
 * LiveKit. We resolve the full profile from the server member list so avatars,
 * colours and status dots match the rest of the app.
 */
export function resolveParticipantUser(
  identity: string,
  name: string,
  members: MemberDto[],
  fallbackUsers: PublicUser[] = [],
): PublicUser {
  const member = members.find((entry) => entry.user_id === identity);
  if (member) return member.user;
  const user = fallbackUsers.find((entry) => entry.id === identity);
  if (user) return user;

  const isRadio = identity.startsWith('mahyar-radio-');
  return {
    id: identity,
    username: name || identity,
    display_name: isRadio ? 'Mahyar Radio' : name || identity,
    avatar_url: null,
    avatar_color: isRadio ? '#eb459e' : hashColor(identity),
    banner_color: '#1e1f22',
    status: 'ONLINE',
    custom_status: null,
    bio: null,
    created_at: '',
  };
}

export function isRadioIdentity(identity: string): boolean {
  return identity.startsWith('mahyar-radio-');
}
