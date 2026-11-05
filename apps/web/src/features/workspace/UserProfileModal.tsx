import { useEffect, useState } from 'react';
import { MessageCircle, UserMinus } from 'lucide-react';
import { useI18n } from '../../i18n';
import { api } from '../../lib/api';
import { useAuthStore } from '../../stores/auth';
import { useDataStore } from '../../stores/data';
import { useUiStore } from '../../stores/ui';
import { Avatar, Modal, Spinner } from '../../components/ui';
import type { PublicUser } from '../../lib/types';

export function UserProfileModal() {
  const { t } = useI18n();
  const modal = useUiStore((s) => s.modal);
  const modalArg = useUiStore((s) => s.modalArg);
  const closeModal = useUiStore((s) => s.closeModal);
  const pushToast = useUiStore((s) => s.pushToast);
  const me = useAuthStore((s) => s.user);
  const refreshFriends = useDataStore((s) => s.refreshFriends);
  const selectConversation = useDataStore((s) => s.selectConversation);
  const refreshConversations = useDataStore((s) => s.refreshConversations);
  const friends = useDataStore((s) => s.friends);
  const [profile, setProfile] = useState<PublicUser | null>(null);

  useEffect(() => {
    if (modal !== 'userProfile' || !modalArg) return;
    setProfile(null);
    void api<{ user: PublicUser }>(`/api/users/${modalArg}`)
      .then((data) => setProfile(data.user))
      .catch((error) => pushToast((error as Error).message, 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modal, modalArg]);

  if (modal !== 'userProfile') return null;

  const isSelf = me?.id === modalArg;
  const isFriend = friends?.friends.some((f) => f.user.id === modalArg) ?? false;

  async function startDm() {
    try {
      const result = await api<{ conversation: { conversation_id: string } }>('/api/dm/conversations', {
        method: 'POST',
        body: { participant_ids: [modalArg] },
      });
      await refreshConversations();
      closeModal();
      void selectConversation(result.conversation.conversation_id);
    } catch (error) {
      pushToast((error as Error).message, 'error');
    }
  }

  async function removeFriend() {
    try {
      await api(`/api/friends/${modalArg}`, { method: 'DELETE' });
      await refreshFriends();
    } catch (error) {
      pushToast((error as Error).message, 'error');
    }
  }

  return (
    <Modal title={t('profile')} onClose={closeModal} width={380}>
      {!profile ? (
        <Spinner />
      ) : (
        <div>
          <div
            className="-mx-5 -mt-5 mb-4 h-20"
            style={{ background: profile.banner_color || 'var(--brand-gradient)' }}
          />
          <div className="-mt-14 mb-3 flex justify-center">
            <Avatar user={profile} size={84} showStatus />
          </div>
          <h2 className="text-center text-lg font-bold">{profile.display_name}</h2>
          <p className="mb-2 text-center text-xs text-[var(--text-muted)]">@{profile.username}</p>
          {profile.custom_status && (
            <p className="mb-2 text-center text-sm text-[var(--text-secondary)]">{profile.custom_status}</p>
          )}
          {profile.bio && <p className="mb-3 text-center text-sm text-[var(--text-secondary)]">{profile.bio}</p>}
          {!isSelf && (
            <div className="mt-4 flex justify-center gap-2">
              <button type="button" className="btn btn-primary text-xs" onClick={() => void startDm()}>
                <MessageCircle size={14} /> {t('directMessages')}
              </button>
              {isFriend && (
                <button type="button" className="btn btn-secondary text-xs" onClick={() => void removeFriend()}>
                  <UserMinus size={14} /> {t('remove')}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
