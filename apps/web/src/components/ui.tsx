import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import type { PublicUser } from '../lib/types';

export function Avatar({
  user,
  size = 36,
  showStatus = false,
}: {
  user: PublicUser;
  size?: number;
  showStatus?: boolean;
}) {
  const statusColor =
    user.status === 'ONLINE'
      ? 'var(--status-online)'
      : user.status === 'IDLE'
        ? 'var(--status-idle)'
        : user.status === 'DND'
          ? 'var(--status-dnd)'
          : 'var(--status-offline)';
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {user.avatar_url ? (
        <img
          src={user.avatar_url}
          alt={user.display_name}
          className="h-full w-full rounded-full object-cover"
          style={{ backgroundColor: user.avatar_color }}
        />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center rounded-full font-semibold text-white"
          style={{ backgroundColor: user.avatar_color, fontSize: size * 0.38 }}
          aria-label={user.display_name}
        >
          {user.display_name.slice(0, 1).toUpperCase()}
        </div>
      )}
      {showStatus && (
        <span
          className="absolute -bottom-0.5 -end-0.5 h-3 w-3 rounded-full border-2"
          style={{ backgroundColor: statusColor, borderColor: 'var(--bg-sidebar)' }}
          title={user.status}
        />
      )}
    </div>
  );
}

export function Modal({
  title,
  children,
  onClose,
  width = 480,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  width?: number;
}) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="card w-full p-5"
        style={{ maxWidth: width, background: 'var(--bg-floating)', boxShadow: 'var(--shadow-panel)' }}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">{title}</h2>
          <button type="button" className="btn btn-ghost p-1" onClick={onClose} aria-label="close">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 p-6 text-[var(--text-secondary)]" role="status">
      <span
        className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent"
        aria-hidden="true"
      />
      {label && <span>{label}</span>}
    </div>
  );
}

export function EmptyState({ icon, text }: { icon?: ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-10 text-center text-[var(--text-muted)]">
      {icon}
      <p className="max-w-xs text-sm">{text}</p>
    </div>
  );
}

export function Toast({ message, tone = 'info' }: { message: string; tone?: 'info' | 'error' }) {
  return (
    <div
      className="pointer-events-auto rounded-[var(--radius)] px-4 py-3 text-sm shadow-lg"
      style={{
        background: 'var(--bg-floating)',
        color: tone === 'error' ? 'var(--danger)' : 'var(--text-primary)',
        border: `1px solid ${tone === 'error' ? 'var(--danger)' : 'var(--border-subtle)'}`,
      }}
      role="alert"
    >
      {message}
    </div>
  );
}
