import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Hash, Lock, Paperclip, Pin, Send, Volume2, X, Bell } from 'lucide-react';
import { useI18n } from '../../i18n';
import { api, uploadFile } from '../../lib/api';
import { emitSocket } from '../../lib/socket';
import { useAuthStore } from '../../stores/auth';
import { useDataStore } from '../../stores/data';
import { useUiStore } from '../../stores/ui';
import { EmptyState, Spinner } from '../../components/ui';
import { MessageItem } from './MessageItem';
import type { ChannelDto, DmMessageDto, MessageDto } from '../../lib/types';

const ALLOWED_UPLOAD_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/webm',
  'audio/ogg',
  'audio/mpeg',
  'audio/wav',
  'application/pdf',
  'text/plain',
]);
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

interface ComposerProps {
  contextId: string;
  isDm: boolean;
  placeholder: string;
  onOptimistic: (message: MessageDto) => void;
}

export function Composer({ contextId, isDm, placeholder, onOptimistic }: ComposerProps) {
  const { t } = useI18n();
  const me = useAuthStore((s) => s.user);
  const replyTarget = useUiStore((s) => s.replyTarget);
  const setReplyTarget = useUiStore((s) => s.setReplyTarget);
  const pushToast = useUiStore((s) => s.pushToast);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [uploads, setUploads] = useState<Array<{ url: string; name: string; content_type: string; size: number }>>([]);
  const [uploading, setUploading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastTypingSent = useRef(0);

  const replyForHere = replyTarget && replyTarget.contextId === contextId ? replyTarget : null;

  const sendTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingSent.current < 2500) return;
    lastTypingSent.current = now;
    if (isDm) emitSocket('dm:typing', { conversationId: contextId });
    else emitSocket('typing:start', { channelId: contextId });
  }, [contextId, isDm]);

  async function pickFiles(files: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files)) {
      if (!ALLOWED_UPLOAD_TYPES.has(file.type)) {
        pushToast(`${t('fileTypeNotAllowed')}: ${file.name}`, 'error');
        continue;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        pushToast(`${t('fileTooLarge')}: ${file.name}`, 'error');
        continue;
      }
      setUploading(true);
      try {
        const uploaded = await uploadFile(file);
        setUploads((prev) => [
          ...prev,
          { url: uploaded.url, name: uploaded.name, content_type: uploaded.content_type, size: uploaded.size },
        ]);
      } catch (error) {
        pushToast(`${t('uploadFailed')}: ${(error as Error).message}`, 'error');
      } finally {
        setUploading(false);
      }
    }
  }

  async function send() {
    const content = text.trim();
    if (!content && uploads.length === 0) return;
    setSending(true);
    const replyId = replyForHere?.messageId ?? null;
    // Optimistic row (real one replaces it via socket echo / response).
    const optimistic = {
      id: `pending-${Date.now()}`,
      channel_id: isDm ? undefined : contextId,
      conversation_id: isDm ? contextId : undefined,
      user_id: me?.id ?? '',
      content,
      reply_to_id: replyId,
      pinned: false,
      edited: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      author: me!,
      attachments: uploads.map((u, index) => ({ id: `pending-${index}`, ...u })),
      reactions: {},
    } as unknown as MessageDto & DmMessageDto;
    onOptimistic(optimistic);
    setText('');
    setUploads([]);
    setReplyTarget(null);
    try {
      if (isDm) {
        await api(`/api/dm/conversations/${contextId}/messages`, {
          method: 'POST',
          body: { content, reply_to_id: replyId, attachments: uploads.length ? uploads : undefined },
        });
      } else {
        await api(`/api/channels/${contextId}/messages`, {
          method: 'POST',
          body: { content, reply_to_id: replyId, attachments: uploads.length ? uploads : undefined },
        });
      }
    } catch (error) {
      pushToast((error as Error).message, 'error');
      useDataStore.setState((state) => {
        if (isDm) {
          return { dmMessages: { ...state.dmMessages, [contextId]: (state.dmMessages[contextId] ?? []).filter((m) => m.id !== optimistic.id) } };
        }
        return { messagesByChannel: { ...state.messagesByChannel, [contextId]: (state.messagesByChannel[contextId] ?? []).filter((m) => m.id !== optimistic.id) } };
      });
      setText(content);
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  }

  return (
    <div className="px-4 pb-4">
      {replyForHere && (
        <div className="mb-1 flex items-center gap-2 rounded-t-lg px-3 py-1.5 text-xs" style={{ background: 'var(--bg-elevated)' }}>
          <span className="text-[var(--text-muted)]">
            {t('reply')} → <strong>{replyForHere.authorName}</strong>
          </span>
          <span className="min-w-0 flex-1 truncate text-[var(--text-secondary)]">{replyForHere.snippet}</span>
          <button type="button" className="btn btn-ghost p-0.5" onClick={() => setReplyTarget(null)} aria-label="cancel reply">
            <X size={13} />
          </button>
        </div>
      )}
      {uploads.length > 0 && (
        <div className="mb-1 flex flex-wrap gap-2 rounded-t-lg px-3 py-2" style={{ background: 'var(--bg-elevated)' }}>
          {uploads.map((upload, index) => (
            <span key={`${upload.url}-${index}`} className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs" style={{ background: 'var(--bg-input)' }}>
              📎 {upload.name}
              <button type="button" onClick={() => setUploads((prev) => prev.filter((_, i) => i !== index))} aria-label="remove">
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div
        className="flex items-end gap-2 rounded-[var(--radius)] px-3 py-2"
        style={{ background: 'var(--bg-input)', border: '1px solid var(--border-subtle)' }}
      >
        <label className="btn btn-ghost cursor-pointer p-1" title={t('attachment')} aria-label={t('attachment')}>
          <Paperclip size={18} />
          <input
            type="file"
            multiple
            className="hidden"
            accept={[...ALLOWED_UPLOAD_TYPES].join(',')}
            onChange={(e) => {
              void pickFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </label>
        <textarea
          ref={textareaRef}
          className="max-h-40 min-h-6 flex-1 resize-none bg-transparent py-1 text-sm outline-none"
          dir="auto"
          placeholder={placeholder}
          value={text}
          rows={1}
          onChange={(e) => {
            setText(e.target.value);
            sendTyping();
            e.target.style.height = 'auto';
            e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button
          type="button"
          className="btn btn-primary p-2"
          onClick={() => void send()}
          disabled={sending || uploading || (!text.trim() && uploads.length === 0)}
          aria-label={t('send')}
        >
          <Send size={17} />
        </button>
      </div>
    </div>
  );
}

interface ChatViewProps {
  channel: ChannelDto;
}

export function ChatView({ channel }: ChatViewProps) {
  const { t } = useI18n();
  const messages = useDataStore((s) => s.messagesByChannel[channel.id]);
  const hasMore = useDataStore((s) => s.hasMoreByChannel[channel.id] ?? false);
  const loadOlder = useDataStore((s) => s.loadOlderMessages);
  const markRead = useDataStore((s) => s.markChannelRead);
  const notifications = useDataStore((s) => s.notifications);
  const openModal = useUiStore((s) => s.openModal);
  const pushToast = useUiStore((s) => s.pushToast);
  // Stable-map selectors; index in the body (new refs inside selectors loop zustand v5).
  const typingMap = useDataStore((s) => s.typing);
  const typingUsers = typingMap[channel.id] ?? [];
  const membersMap = useDataStore((s) => s.membersByServer);
  const members = membersMap[channel.server_id] ?? [];
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const filtered = useMemo(() => {
    if (!search.trim()) return messages;
    return (messages ?? []).filter((m) => m.content.toLowerCase().includes(search.toLowerCase()));
  }, [messages, search]);

  useEffect(() => {
    stickToBottom.current = true;
    markRead(channel.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id]);

  useEffect(() => {
    if (stickToBottom.current && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, typingUsers.length]);

  function onScroll() {
    const el = listRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    markRead(channel.id);
  }

  async function loadOlderClick() {
    const el = listRef.current;
    const previousHeight = el?.scrollHeight ?? 0;
    await loadOlder(channel.id);
    requestAnimationFrame(() => {
      if (el) el.scrollTop = el.scrollHeight - previousHeight;
    });
  }

  function onOptimistic(message: MessageDto) {
    stickToBottom.current = true;
    useDataStore.setState((state) => ({
      messagesByChannel: {
        ...state.messagesByChannel,
        [channel.id]: [...(state.messagesByChannel[channel.id] ?? []), message],
      },
    }));
  }

  const messageById = useMemo(() => {
    const map = new Map<string, MessageDto | DmMessageDto>();
    for (const message of messages ?? []) map.set(message.id, message);
    return map;
  }, [messages]);

  const typingNames = typingUsers
    .map((userId) => members.find((m) => m.user_id === userId)?.user.display_name ?? userId)
    .slice(0, 3);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 px-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        {channel.type === 'VOICE' ? <Volume2 size={17} /> : channel.is_private ? <Lock size={16} /> : <Hash size={16} />}
        <h1 className="text-sm font-bold">{channel.name}</h1>
        {channel.topic && <span className="hidden truncate text-xs text-[var(--text-muted)] md:inline">— {channel.topic}</span>}
        <div className="flex-1" />
        <button
          type="button"
          className="btn btn-ghost relative p-1.5"
          title={t('notifications')}
          aria-label={t('notifications')}
          onClick={() => openModal('notifications')}
        >
          <Bell size={16} />
          {notifications.some((n) => !n.read) && (
            <span className="absolute end-0.5 top-0.5 h-2 w-2 rounded-full" style={{ background: 'var(--danger)' }} />
          )}
        </button>
        <button
          type="button"
          className="btn btn-ghost p-1.5"
          title={t('pinnedMessages')}
          onClick={async () => {
            const pins = await api<{ messages: MessageDto[] }>(`/api/channels/${channel.id}/pins`);
            pushToast(
              pins.messages.length ? pins.messages.map((m) => `📌 ${m.author.display_name}: ${m.content.slice(0, 40)}`).join('\n') : t('pinnedMessages'),
            );
          }}
        >
          <Pin size={16} />
        </button>
        <button
          type="button"
          className="btn btn-ghost p-1.5"
          title={t('search')}
          onClick={() => {
            setSearchOpen(!searchOpen);
            setSearch('');
          }}
        >
          <span className="text-xs">🔍</span>
        </button>
      </header>

      {searchOpen && (
        <div className="px-4 py-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <input className="input" dir="auto" placeholder={t('search')} value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
        </div>
      )}

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-4" onScroll={onScroll}>
        {hasMore && !search && (
          <div className="mb-2 text-center">
            <button type="button" className="btn btn-secondary text-xs" onClick={() => void loadOlderClick()}>
              {t('loadOlder')}
            </button>
          </div>
        )}
        {!messages && !search ? (
          <Spinner label={t('loading')} />
        ) : filtered.length === 0 ? (
          <EmptyState text={search ? t('notFound') : t('emptyChannel')} icon={<Hash size={28} />} />
        ) : (
          filtered.map((message, index) => {
            const previous = filtered[index - 1];
            const showHeader =
              !previous ||
              previous.user_id !== message.user_id ||
              new Date(message.created_at).getTime() - new Date(previous.created_at).getTime() > 5 * 60_000;
            return (
              <MessageItem
                key={message.id}
                message={message}
                isDm={false}
                context={channel}
                replyTarget={message.reply_to_id ? messageById.get(message.reply_to_id) ?? null : null}
                showHeader={showHeader}
              />
            );
          })
        )}
      </div>

      <div className="h-5 px-6 text-xs text-[var(--text-muted)]" aria-live="polite">
        {typingNames.length > 0 && (
          <span className="inline-flex items-center gap-1">
            <span className="flex gap-0.5">
              <span className="typing-dot inline-block h-1 w-1 rounded-full bg-current" />
              <span className="typing-dot inline-block h-1 w-1 rounded-full bg-current" />
              <span className="typing-dot inline-block h-1 w-1 rounded-full bg-current" />
            </span>
            {typingNames.join(', ')} {t('typing')}
          </span>
        )}
      </div>

      <Composer contextId={channel.id} isDm={false} placeholder={t('messagePlaceholder')} onOptimistic={onOptimistic} />
    </div>
  );
}
