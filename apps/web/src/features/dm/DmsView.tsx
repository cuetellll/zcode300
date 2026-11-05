import { useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquare, Phone, Plus, Users } from 'lucide-react';
import { useI18n } from '../../i18n';
import { api } from '../../lib/api';
import { useAuthStore } from '../../stores/auth';
import { useDataStore } from '../../stores/data';
import { useUiStore } from '../../stores/ui';
import { useVoiceStore } from '../../stores/voice';
import { Avatar, EmptyState, Modal, Spinner } from '../../components/ui';
import { MessageItem } from '../chat/MessageItem';
import { Composer } from '../chat/ChatView';
import type { ConversationDto, DmMessageDto, PublicUser } from '../../lib/types';

export function DmsView() {
  const { t } = useI18n();
  const me = useAuthStore((s) => s.user);
  const conversations = useDataStore((s) => s.conversations);
  const activeConversationId = useDataStore((s) => s.activeConversationId);
  const selectConversation = useDataStore((s) => s.selectConversation);
  const refreshConversations = useDataStore((s) => s.refreshConversations);
  const unreadBadges = useDataStore((s) => s.unreadBadges);
  const [newOpen, setNewOpen] = useState(false);
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [userSearch, setUserSearch] = useState('');

  useEffect(() => {
    void refreshConversations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openPicker() {
    setNewOpen(true);
    const data = await api<{ users: PublicUser[] }>('/api/users?limit=50');
    setUsers(data.users);
  }

  async function startWith(userId: string) {
    const result = await api<{ conversation: ConversationDto }>('/api/dm/conversations', {
      method: 'POST',
      body: { participant_ids: [userId] },
    });
    await refreshConversations();
    setNewOpen(false);
    void selectConversation(result.conversation.conversation_id);
  }

  const sorted = useMemo(
    () =>
      [...conversations].sort((a, b) =>
        (b.last_message_at ?? '').localeCompare(a.last_message_at ?? ''),
      ),
    [conversations],
  );

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-64 shrink-0 flex-col border-e" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-sidebar)' }}>
        <header className="flex h-12 items-center justify-between px-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <h1 className="text-sm font-bold">{t('directMessages')}</h1>
          <button type="button" className="btn btn-ghost p-1" onClick={() => void openPicker()} title={t('newConversation')}>
            <Plus size={16} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-2">
          {sorted.length === 0 ? (
            <p className="p-3 text-xs text-[var(--text-muted)]">{t('noFriendsYet')}</p>
          ) : (
            sorted.map((conversation) => {
              const others = conversation.participants.filter((p) => p.id !== me?.id);
              const title = conversation.is_group
                ? conversation.group_name ?? others.map((o) => o.display_name).join(', ')
                : others[0]?.display_name ?? '—';
              const unread = unreadBadges[conversation.conversation_id] ?? 0;
              const active = activeConversationId === conversation.conversation_id;
              return (
                <button
                  key={conversation.conversation_id}
                  type="button"
                  onClick={() => void selectConversation(conversation.conversation_id)}
                  className="mb-0.5 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start hover:bg-[var(--bg-elevated)]"
                  style={{ background: active ? 'var(--bg-elevated)' : undefined }}
                >
                  {conversation.is_group ? (
                    <span className="flex h-9 w-9 items-center justify-center rounded-full" style={{ background: 'var(--bg-input)' }}>
                      <Users size={16} />
                    </span>
                  ) : (
                    <Avatar user={others[0] ?? me!} size={36} />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm" style={{ fontWeight: active || unread ? 600 : 400 }}>
                      {title}
                    </span>
                  </span>
                  {unread > 0 && (
                    <span className="flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white" style={{ background: 'var(--danger)' }}>
                      {unread}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>

      {activeConversationId ? (
        <DmThread conversationId={activeConversationId} />
      ) : (
        <div className="flex-1">
          <EmptyState text={t('newConversation')} icon={<MessageSquare size={28} />} />
        </div>
      )}

      {newOpen && (
        <Modal title={t('newConversation')} onClose={() => setNewOpen(false)}>
          <input className="input mb-3" dir="auto" placeholder={t('search')} value={userSearch} onChange={(e) => setUserSearch(e.target.value)} />
          <div className="max-h-72 overflow-y-auto">
            {users
              .filter((u) => u.id !== me?.id)
              .filter((u) => !userSearch || u.display_name.includes(userSearch) || u.username.includes(userSearch.toLowerCase()))
              .map((user) => (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => void startWith(user.id)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start hover:bg-[var(--bg-elevated)]"
                >
                  <Avatar user={user} size={32} />
                  <span className="min-w-0 flex-1 truncate text-sm">{user.display_name}</span>
                  <span className="text-xs text-[var(--text-muted)]">@{user.username}</span>
                </button>
              ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

function DmThread({ conversationId }: { conversationId: string }) {
  const { t } = useI18n();
  const me = useAuthStore((s) => s.user);
  const conversations = useDataStore((s) => s.conversations);
  const messages = useDataStore((s) => s.dmMessages[conversationId]);
  const hasMore = useDataStore((s) => s.dmHasMore[conversationId] ?? false);
  const typingUsers = useDataStore((s) => s.dmTyping[conversationId] ?? []);
  const loadOlder = useDataStore((s) => s.loadOlderDmMessages);
  const markRead = useDataStore((s) => s.markChannelRead);
  const pushToast = useUiStore((s) => s.pushToast);
  const voice = useVoiceStore();
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const conversation = conversations.find((c) => c.conversation_id === conversationId);
  const others = (conversation?.participants ?? []).filter((p) => p.id !== me?.id);
  const title = conversation?.is_group ? conversation.group_name ?? others.map((o) => o.display_name).join(', ') : others[0]?.display_name ?? '—';

  useEffect(() => {
    stick.current = true;
    markRead(conversationId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  useEffect(() => {
    if (stick.current && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, typingUsers.length]);

  const messageById = useMemo(() => {
    const map = new Map<string, DmMessageDto>();
    for (const message of messages ?? []) map.set(message.id, message);
    return map;
  }, [messages]);

  if (!conversation) return <Spinner label={t('loading')} />;

  const inCall = voice.mode === 'dm' && voice.conversationId === conversationId;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 px-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        {conversation.is_group ? <Users size={16} /> : <Avatar user={others[0] ?? me!} size={26} />}
        <h1 className="text-sm font-bold">{title}</h1>
        <div className="flex-1" />
        {!conversation.is_group && others[0] && (
          <button
            type="button"
            className="btn btn-secondary text-xs"
            onClick={() => {
              void voice.joinDmCall(conversationId).catch((error) => pushToast((error as Error).message, 'error'));
            }}
            disabled={voice.mode !== 'idle' && !inCall}
          >
            <Phone size={14} /> {t('startCall')}
          </button>
        )}
        {inCall && (
          <button type="button" className="btn btn-danger text-xs" onClick={() => void voice.leave()}>
            {t('leaveVoice')}
          </button>
        )}
      </header>

      <div
        ref={listRef}
        className="min-h-0 flex-1 overflow-y-auto py-4"
        onScroll={() => {
          const el = listRef.current;
          if (!el) return;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          markRead(conversationId);
        }}
      >
        {hasMore && (
          <div className="mb-2 text-center">
            <button type="button" className="btn btn-secondary text-xs" onClick={() => void loadOlder(conversationId)}>
              {t('loadOlder')}
            </button>
          </div>
        )}
        {(messages?.length ?? 0) === 0 ? (
          <EmptyState text={t('emptyChannel')} icon={<MessageSquare size={28} />} />
        ) : (
          (messages ?? []).map((message, index) => {
            const previous = (messages ?? [])[index - 1];
            const showHeader =
              !previous ||
              previous.user_id !== message.user_id ||
              new Date(message.created_at).getTime() - new Date(previous.created_at).getTime() > 5 * 60_000;
            return (
              <MessageItem
                key={message.id}
                message={message}
                isDm
                context={null}
                replyTarget={message.reply_to_id ? messageById.get(message.reply_to_id) ?? null : null}
                showHeader={showHeader}
              />
            );
          })
        )}
      </div>

      <Composer
        contextId={conversationId}
        isDm
        placeholder={t('messagePlaceholder')}
        onOptimistic={(message) => {
          stick.current = true;
          useDataStore.setState((state) => ({
            dmMessages: {
              ...state.dmMessages,
              [conversationId]: [...(state.dmMessages[conversationId] ?? []), message as unknown as DmMessageDto],
            },
          }));
        }}
      />
    </div>
  );
}
