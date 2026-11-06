import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import type { PublicUser } from '../lib/types';

/** Deterministic avatar colour for identities without a profile (DM calls). */
export function hashColor(seed: string): string {
  const palette = ['#5865f2', '#3ba55d', '#faa61a', '#ed4245', '#eb459e', '#00a8fc', '#9b59b6', '#e67e22'];
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) % 100000;
  return palette[hash % palette.length];
}

export function Avatar({
  user,
  size = 36,
  showStatus = false,
  speaking = false,
  dimmed = false,
}: {
  user: PublicUser;
  size?: number;
  showStatus?: boolean;
  speaking?: boolean;
  dimmed?: boolean;
}) {
  const statusColor =
    user.status === 'ONLINE'
      ? 'var(--status-online)'
      : user.status === 'IDLE'
        ? 'var(--status-idle)'
        : user.status === 'DND'
          ? 'var(--status-dnd)'
          : 'var(--status-offline)';
  const initial = (user.display_name || user.username || '?').trim().slice(0, 1).toUpperCase();
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div
        className={`h-full w-full rounded-full ${speaking ? 'speaking-ring speaking-pulse' : ''}`}
        style={{ opacity: dimmed ? 0.5 : 1, transition: 'box-shadow 120ms ease, opacity 120ms ease' }}
      >
        {user.avatar_url ? (
          <img
            src={user.avatar_url}
            alt=""
            className="h-full w-full rounded-full object-cover"
            style={{ backgroundColor: user.avatar_color || hashColor(user.id) }}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center rounded-full font-semibold text-white"
            style={{
              backgroundColor: user.avatar_color || hashColor(user.id),
              fontSize: Math.max(10, size * 0.4),
            }}
            aria-hidden="true"
          >
            {initial}
          </div>
        )}
      </div>
      {showStatus && (
        <span
          className="absolute -bottom-0.5 -end-0.5 rounded-full border-2"
          style={{
            backgroundColor: statusColor,
            borderColor: 'var(--bg-sidebar)',
            width: Math.max(10, size * 0.34),
            height: Math.max(10, size * 0.34),
          }}
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
  footer,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  width?: number;
  footer?: ReactNode;
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
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'var(--bg-scrim)' }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="animate-scale-in flex max-h-[90vh] w-full flex-col overflow-hidden"
        style={{
          maxWidth: width,
          background: 'var(--bg-modal)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-modal)',
        }}
      >
        <div className="flex items-center justify-between px-4 pb-3 pt-4">
          <h2 className="text-lg font-bold">{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="close">
            <X size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{children}</div>
        {footer && (
          <div
            className="flex items-center justify-end gap-2 px-4 py-3"
            style={{ background: 'var(--bg-modal-footer)' }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 p-6 text-sm" style={{ color: 'var(--text-secondary)' }} role="status">
      <span
        className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        aria-hidden="true"
      />
      {label && <span>{label}</span>}
    </div>
  );
}

export function EmptyState({ text, icon }: { text: string; icon?: ReactNode }) {
  return (
    <div className="flex h-full min-h-40 flex-col items-center justify-center gap-3 p-6 text-center">
      {icon && <div style={{ color: 'var(--text-muted)' }}>{icon}</div>}
      <p className="max-w-sm text-sm" style={{ color: 'var(--text-muted)' }}>
        {text}
      </p>
    </div>
  );
}

export function Toast({ message, tone }: { message: string; tone: 'info' | 'error' }) {
  return (
    <div
      className="animate-fade-in max-w-md rounded px-3 py-2 text-sm shadow-lg"
      style={{
        background: tone === 'error' ? 'var(--danger)' : 'var(--bg-floating)',
        color: tone === 'error' ? '#fff' : 'var(--text-primary)',
        boxShadow: 'var(--shadow-menu)',
      }}
      role="status"
    >
      {message}
    </div>
  );
}

/**
 * Discord-style context menu. Fixed positioning with viewport clamping so it
 * never opens off-screen (important for the voice panel at the bottom).
 */
export function ContextMenu({
  x,
  y,
  onClose,
  children,
  width = 220,
}: {
  x: number;
  y: number;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const margin = 8;
    const left = Math.min(Math.max(margin, x), window.innerWidth - rect.width - margin);
    const top = Math.min(Math.max(margin, y), window.innerHeight - rect.height - margin);
    setPosition({ left, top });
  }, [x, y]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="menu animate-scale-in fixed z-[70]"
      style={{ left: position.left, top: position.top, width }}
      role="menu"
    >
      {children}
    </div>
  );
}

/** Voice volume slider with a live percentage label (0–200%). */
export function VolumeSlider({
  value,
  onChange,
  label,
  onReset,
  resetLabel,
}: {
  value: number;
  onChange: (value: number) => void;
  label: string;
  onReset?: () => void;
  resetLabel?: string;
}) {
  const percent = Math.round(value * 100);
  return (
    <div className="px-2 py-1.5">
      <div className="mb-1 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
        <span>{label}</span>
        <button
          type="button"
          onClick={onReset}
          disabled={!onReset}
          className="text-[11px] font-semibold tabular-nums"
          style={{ color: percent === 100 ? 'var(--text-muted)' : 'var(--text-link)' }}
          title={resetLabel}
        >
          {percent}%
        </button>
      </div>
      <input
        type="range"
        className="slider"
        min={0}
        max={200}
        step={1}
        value={percent}
        onChange={(event) => onChange(Number(event.target.value) / 100)}
        aria-label={label}
        dir="ltr"
      />
    </div>
  );
}
