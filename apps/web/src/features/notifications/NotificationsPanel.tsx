import { Bell } from 'lucide-react';
import { useI18n } from '../../i18n';
import { api } from '../../lib/api';
import { useDataStore } from '../../stores/data';
import { useUiStore } from '../../stores/ui';
import { Modal, EmptyState } from '../../components/ui';

export function NotificationsPanel() {
  const { t } = useI18n();
  const modal = useUiStore((s) => s.modal);
  const closeModal = useUiStore((s) => s.closeModal);
  const notifications = useDataStore((s) => s.notifications);
  const refreshNotifications = useDataStore((s) => s.refreshNotifications);

  if (modal !== 'notifications') return null;

  async function readAll() {
    await api('/api/notifications/read-all', { method: 'POST' });
    await refreshNotifications();
  }

  return (
    <Modal title={t('notifications')} onClose={closeModal} width={420}>
      <div className="mb-3 flex justify-end">
        <button type="button" className="btn btn-secondary text-xs" onClick={() => void readAll()}>
          {t('markAllRead')}
        </button>
      </div>
      {notifications.length === 0 ? (
        <EmptyState text={t('noNotifications')} icon={<Bell size={28} />} />
      ) : (
        <ul className="max-h-80 space-y-1 overflow-y-auto">
          {notifications.map((notification) => (
            <li
              key={notification.id}
              className="rounded-[var(--radius)] px-3 py-2 text-sm"
              style={{
                background: notification.read ? 'transparent' : 'var(--bg-input)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <div className="flex items-center gap-2">
                {!notification.read && <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--brand-primary)' }} />}
                <strong className="min-w-0 flex-1 truncate">{notification.title}</strong>
                <span className="text-[10px] text-[var(--text-muted)]">
                  {new Date(notification.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              {notification.body && <p className="mt-0.5 truncate text-xs text-[var(--text-secondary)]">{notification.body}</p>}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
