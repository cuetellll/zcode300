import { useEffect, useState } from 'react';
import { Check, MessageCircle, UserPlus, Users, X } from 'lucide-react';
import { useI18n } from '../../i18n';
import { api } from '../../lib/api';
import { useDataStore } from '../../stores/data';
import { useUiStore } from '../../stores/ui';
import { Avatar, EmptyState, Spinner } from '../../components/ui';
import type { PublicUser } from '../../lib/types';

type Tab = 'online' | 'all' | 'pending' | 'add';

export function FriendsView() {
  const { t } = useI18n();
  const friends = useDataStore((s) => s.friends);
  const presence = useDataStore((s) => s.presence);
  const refreshFriends = useDataStore((s) => s.refreshFriends);
  const refreshConversations = useDataStore((s) => s.refreshConversations);
  const selectConversation = useDataStore((s) => s.selectConversation);
  const pushToast = useUiStore((s) => s.pushToast);
  const [tab, setTab] = useState<Tab>('online');
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void refreshFriends();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addFriend() {
    if (!username.trim() || busy) return;
    setBusy(true);
    try {
      await api('/api/friends', { method: 'POST', body: { username: username.trim() } });
      pushToast(t('sendRequest') + ' ✓');
      setUsername('');
      await refreshFriends();
    } catch (error) {
      pushToast((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function accept(userId: string) {
    try {
      await api(`/api/friends/requests/${userId}/accept`, { method: 'POST' });
      await refreshFriends();
    } catch (error) {
      pushToast((error as Error).message, 'error');
    }
  }

  async function decline(userId: string) {
    try {
      await api(`/api/friends/requests/${userId}`, { method: 'DELETE' });
      await refreshFriends();
    } catch (error) {
      pushToast((error as Error).message, 'error');
    }
  }

  async function removeFriend(userId: string) {
    if (!window.confirm(t('remove') + '?')) return;
    try {
      await api(`/api/friends/${userId}`, { method: 'DELETE' });
      await refreshFriends();
    } catch (error) {
      pushToast((error as Error).message, 'error');
    }
  }

  async function block(userId: string) {
    try {
      await api(`/api/friends/${userId}/block`, { method: 'POST' });
      await refreshFriends();
    } catch (error) {
      pushToast((error as Error).message, 'error');
    }
  }

  async function message(user: PublicUser) {
    try {
      const result = await api<{ conversation: { conversation_id: string } }>('/api/dm/conversations', {
        method: 'POST',
        body: { participant_ids: [user.id] },
      });
      await refreshConversations();
      void selectConversation(result.conversation.conversation_id);
    } catch (error) {
      pushToast((error as Error).message, 'error');
    }
  }

  if (!friends) return <Spinner label={t('loading')} />;

  const onlineFriends = friends.friends.filter((f) => presence[f.user.id]);

  const tabs: Array<[Tab, string, number]> = [
    ['online', t('online'), onlineFriends.length],
    ['all', t('all'), friends.friends.length],
    ['pending', t('pending'), friends.incoming_requests.length],
    ['add', t('addFriend'), 0],
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-1 px-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <Users size={16} className="me-2" />
        {tabs.map(([tabKey, label, count]) => (
          <button
            key={tabKey}
            type="button"
            onClick={() => setTab(tabKey)}
            className="rounded-md px-3 py-1 text-sm font-medium transition-colors"
            style={{
              background: tab === tabKey ? 'var(--bg-elevated)' : undefined,
              color: tab === tabKey ? 'var(--text-primary)' : 'var(--text-secondary)',
            }}
          >
            {label}
            {count > 0 && tabKey === 'pending' && <span className="ms-1 text-[var(--brand-accent)]">{count}</span>}
          </button>
        ))}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === 'add' && (
          <div className="card mx-auto max-w-lg p-5">
            <h2 className="mb-1 flex items-center gap-2 font-semibold">
              <UserPlus size={16} /> {t('addFriend')}
            </h2>
            <p className="mb-3 text-xs text-[var(--text-muted)]">{t('addFriendHint')}</p>
            <div className="flex gap-2">
              <input
                className="input"
                dir="ltr"
                placeholder={t('username')}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void addFriend();
                }}
              />
              <button type="button" className="btn btn-primary" onClick={() => void addFriend()} disabled={busy || !username.trim()}>
                {t('sendRequest')}
              </button>
            </div>
          </div>
        )}

        {tab === 'pending' && (
          <div className="mx-auto max-w-2xl">
            {friends.incoming_requests.length === 0 ? (
              <EmptyState text={t('pending')} icon={<UserPlus size={28} />} />
            ) : (
              friends.incoming_requests.map((request) => (
                <Row key={request.request_id} user={request.user} actions={
                  <>
                    <button type="button" className="btn btn-primary p-2" title={t('accept')} onClick={() => void accept(request.user.id)}>
                      <Check size={16} />
                    </button>
                    <button type="button" className="btn btn-secondary p-2" title={t('decline')} onClick={() => void decline(request.user.id)}>
                      <X size={16} />
                    </button>
                  </>
                } />
              ))
            )}
          </div>
        )}

        {(tab === 'online' || tab === 'all') && (
          <div className="mx-auto max-w-2xl">
            {(tab === 'online' ? onlineFriends : friends.friends).length === 0 ? (
              <EmptyState text={t('noFriendsYet')} icon={<Users size={28} />} />
            ) : (
              (tab === 'online' ? onlineFriends : friends.friends).map((entry) => (
                <Row
                  key={entry.user.id}
                  user={entry.user}
                  dim={!presence[entry.user.id]}
                  actions={
                    <>
                      <button type="button" className="btn btn-secondary p-2" title={t('directMessages')} onClick={() => void message(entry.user)}>
                        <MessageCircle size={16} />
                      </button>
                      <button type="button" className="btn btn-ghost p-2" title={t('remove')} onClick={() => void removeFriend(entry.user.id)}>
                        <X size={16} />
                      </button>
                      <button type="button" className="btn btn-ghost p-2 text-xs text-[var(--danger)]" title={t('block')} onClick={() => void block(entry.user.id)}>
                        ⛔
                      </button>
                    </>
                  }
                />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({
  user,
  actions,
  dim = false,
}: {
  user: PublicUser;
  actions: React.ReactNode;
  dim?: boolean;
}) {
  return (
    <div
      className="mb-1 flex items-center gap-3 rounded-[var(--radius)] border px-3 py-2"
      style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)', opacity: dim ? 0.5 : 1 }}
    >
      <Avatar user={user} size={36} showStatus />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{user.display_name}</div>
        <div className="truncate text-xs text-[var(--text-muted)]">@{user.username}</div>
      </div>
      <div className="flex items-center gap-1">{actions}</div>
    </div>
  );
}
