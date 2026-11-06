import { memo, useRef, useState } from 'react';
import { CornerUpLeft, Pencil, Pin, PinOff, Smile, Trash2 } from 'lucide-react';
import { useI18n } from '../../i18n';
import { api } from '../../lib/api';
import { useAuthStore } from '../../stores/auth';
import { useUiStore } from '../../stores/ui';
import { Avatar } from '../../components/ui';
import { formatTime } from '../../lib/format';
import type { ChannelDto, DmMessageDto, MessageDto } from '../../lib/types';

const QUICK_EMOJI = ['👍', '❤️', '😂', '🔥', '🚀', '😢'];

export function renderContent(content: string): React.ReactNode[] {
  if (!content) return [];
  const nodes: React.ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|@everyone|@[a-zA-Z0-9_.-]{3,32})/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(content)) !== null) {
    if (match.index > lastIndex) nodes.push(content.slice(lastIndex, match.index));
    const token = match[0];
    if (token.startsWith('**')) {
      nodes.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('`')) {
      nodes.push(
        <code key={key++} className="rounded px-1 py-0.5 text-[13px]" style={{ background: 'var(--bg-input)' }}>
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      nodes.push(
        <span key={key++} className="rounded px-0.5 font-medium" style={{ background: 'rgba(124,92,255,0.18)', color: 'var(--brand-primary)' }}>
          {token}
        </span>,
      );
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < content.length) nodes.push(content.slice(lastIndex));
  return nodes;
}

interface MessageItemProps {
  message: MessageDto | DmMessageDto;
  isDm: boolean;
  context: ChannelDto | null;
  replyTarget?: MessageDto | DmMessageDto | null;
  showHeader: boolean;
}

export const MessageItem = memo(function MessageItem({
  message,
  isDm,
  context,
  replyTarget,
  showHeader,
}: MessageItemProps) {
  const { t } = useI18n();
  const me = useAuthStore((s) => s.user);
  const pushToast = useUiStore((s) => s.pushToast);
  const setReplyTarget = useUiStore((s) => s.setReplyTarget);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(message.content);
  const [pickerOpen, setPickerOpen] = useState(false);
  const editRef = useRef<HTMLInputElement>(null);

  const mine = me?.id === message.user_id;
  void context;

  async function toggleReaction(emoji: string) {
    setPickerOpen(false);
    try {
      if (isDm) {
        await api(`/api/dm/messages/${message.id}/reactions`, { method: 'PUT', body: { emoji } });
      } else {
        await api(`/api/messages/${message.id}/reactions`, { method: 'PUT', body: { emoji } });
      }
    } catch (error) {
      pushToast((error as Error).message, 'error');
    }
  }

  async function saveEdit() {
    const content = editText.trim();
    if (!content) return;
    try {
      if (isDm) {
        await api(`/api/dm/messages/${message.id}`, { method: 'PATCH', body: { content } });
      } else {
        await api(`/api/messages/${message.id}`, { method: 'PATCH', body: { content } });
      }
      setEditing(false);
    } catch (error) {
      pushToast((error as Error).message, 'error');
    }
  }

  async function remove() {
    if (!window.confirm(t('delete') + '?')) return;
    try {
      if (isDm) {
        await api(`/api/dm/messages/${message.id}`, { method: 'DELETE' });
      } else {
        await api(`/api/messages/${message.id}`, { method: 'DELETE' });
      }
    } catch (error) {
      pushToast((error as Error).message, 'error');
    }
  }

  async function togglePin() {
    try {
      if (isDm) {
        await api(`/api/dm/messages/${message.id}/pin`, { method: 'POST', body: { pinned: !message.pinned } });
      } else {
        await api(`/api/messages/${message.id}/pin`, { method: 'POST', body: { pinned: !message.pinned } });
      }
    } catch (error) {
      pushToast((error as Error).message, 'error');
    }
  }

  function startReply() {
    setReplyTarget({
      contextId: isDm ? (message as DmMessageDto).conversation_id : (message as MessageDto).channel_id,
      messageId: message.id,
      authorName: message.author.display_name,
      snippet: message.content.slice(0, 100),
    });
  }

  const reactionEntries = Object.entries(message.reactions ?? {}).filter(([, users]) => users.length > 0);

  return (
    <div className="group relative px-4 py-0.5 transition-colors hover:bg-[var(--bg-elevated)]" style={{ marginTop: showHeader ? 14 : 0 }}>
      {showHeader && (
        <div className="mb-0.5 flex items-center gap-2">
          <Avatar user={message.author} size={40} />
          <span className="text-base font-semibold">{message.author.display_name}</span>
          <span className="text-[11px] text-[var(--text-muted)]">{formatTime(message.created_at)}</span>
          {message.pinned && (
            <span className="text-[10px] text-[var(--brand-accent)]" title={t('pinnedMessages')}>
              <Pin size={11} className="inline" />
            </span>
          )}
        </div>
      )}
      {replyTarget && (
        <div className="mb-1 ms-[52px] flex items-center gap-1 text-xs text-[var(--text-muted)]">
          <CornerUpLeft size={11} />
          <span className="font-medium text-[var(--text-secondary)]">{replyTarget.author.display_name}</span>
          <span className="truncate">{replyTarget.content.slice(0, 80)}</span>
        </div>
      )}

      {editing ? (
        <div className="ms-[52px] flex gap-2">
          <input
            ref={editRef}
            className="input"
            value={editText}
            autoFocus
            onChange={(e) => setEditText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) void saveEdit();
              if (e.key === 'Escape') setEditing(false);
            }}
          />
          <button type="button" className="btn btn-primary" onClick={() => void saveEdit()}>
            {t('save')}
          </button>
        </div>
      ) : (
        message.content && (
          <p className="ms-[52px] whitespace-pre-wrap break-words text-[15px] leading-[1.375rem]" dir="auto">
            {renderContent(message.content)}
          </p>
        )
      )}

      {message.attachments.length > 0 && (
        <div className="ms-[52px] mt-1 flex flex-wrap gap-2">
          {message.attachments.map((attachment) =>
            attachment.content_type.startsWith('image/') ? (
              <a key={attachment.id} href={attachment.url} target="_blank" rel="noreferrer">
                <img
                  src={attachment.url}
                  alt={attachment.name}
                  className="max-h-64 rounded-[var(--radius)] border"
                  style={{ borderColor: 'var(--border-subtle)' }}
                  loading="lazy"
                />
              </a>
            ) : attachment.content_type.startsWith('video/') ? (
              <video key={attachment.id} src={attachment.url} controls className="max-h-64 rounded-[var(--radius)]" />
            ) : (
              <a
                key={attachment.id}
                href={attachment.url}
                target="_blank"
                rel="noreferrer"
                className="card flex items-center gap-2 px-3 py-2 text-xs hover:border-[var(--brand-primary)]"
              >
                📎 <span className="max-w-48 truncate">{attachment.name}</span>
                <span className="text-[var(--text-muted)]">{Math.max(1, Math.round(attachment.size / 1024))} KB</span>
              </a>
            ),
          )}
        </div>
      )}

      {reactionEntries.length > 0 && (
        <div className="ms-[52px] mt-1 flex flex-wrap gap-1">
          {reactionEntries.map(([emoji, users]) => (
            <button
              key={emoji}
              type="button"
              className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors"
              style={{
                borderColor: users.includes(me?.id ?? '') ? 'var(--brand-primary)' : 'var(--border-subtle)',
                background: users.includes(me?.id ?? '') ? 'rgba(124,92,255,0.12)' : 'var(--bg-input)',
              }}
              onClick={() => void toggleReaction(emoji)}
              title={users.map((userId) => userId).join(', ')}
            >
              <span>{emoji}</span>
              <span className="text-[var(--text-secondary)]">{users.length}</span>
            </button>
          ))}
        </div>
      )}

      {/* hover toolbar */}
      <div
        className="absolute -top-3 end-4 hidden items-center gap-0.5 rounded-lg border p-0.5 group-hover:flex"
        style={{ background: 'var(--bg-floating)', borderColor: 'var(--border-subtle)' }}
      >
        <div className="relative">
          <button type="button" className="btn btn-ghost p-1" title="React" onClick={() => setPickerOpen(!pickerOpen)}>
            <Smile size={15} />
          </button>
          {pickerOpen && (
            <div
              className="absolute bottom-full end-0 z-10 mb-1 flex gap-0.5 rounded-lg border p-1"
              style={{ background: 'var(--bg-floating)', borderColor: 'var(--border-subtle)' }}
            >
              {QUICK_EMOJI.map((emoji) => (
                <button key={emoji} type="button" className="rounded p-1 text-base hover:bg-[var(--bg-elevated)]" onClick={() => void toggleReaction(emoji)}>
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>
        <button type="button" className="btn btn-ghost p-1" title={t('reply')} onClick={startReply}>
          <CornerUpLeft size={15} />
        </button>
        <button type="button" className="btn btn-ghost p-1" title={t('pin')} onClick={() => void togglePin()}>
          {message.pinned ? <PinOff size={15} /> : <Pin size={15} />}
        </button>
        {mine && (
          <>
            <button
              type="button"
              className="btn btn-ghost p-1"
              title={t('edit')}
              onClick={() => {
                setEditText(message.content);
                setEditing(true);
                setTimeout(() => editRef.current?.focus(), 0);
              }}
            >
              <Pencil size={15} />
            </button>
            <button type="button" className="btn btn-ghost p-1" title={t('delete')} onClick={() => void remove()}>
              <Trash2 size={15} />
            </button>
          </>
        )}
      </div>
    </div>
  );
});
