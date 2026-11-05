import { useRef, useState } from 'react';
import { useI18n } from '../../i18n';
import { api } from '../../lib/api';
import { useAuthStore } from '../../stores/auth';
import { useDataStore } from '../../stores/data';
import { useUiStore } from '../../stores/ui';
import { Avatar, Modal } from '../../components/ui';
import type { PublicUser, UserStatus } from '../../lib/types';

const MAX_AVATAR_BYTES = 256 * 1024;

export function SettingsModal() {
  const { t, lang, setLang } = useI18n();
  const modal = useUiStore((s) => s.modal);
  const closeModal = useUiStore((s) => s.closeModal);
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const pushToast = useUiStore((s) => s.pushToast);
  const me = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const refreshFriends = useDataStore((s) => s.refreshFriends);

  const [displayName, setDisplayName] = useState(me?.display_name ?? '');
  const [customStatus, setCustomStatus] = useState(me?.custom_status ?? '');
  const [bio, setBio] = useState(me?.bio ?? '');
  const [status, setStatus] = useState<UserStatus>(me?.status ?? 'ONLINE');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  if (modal !== 'settings' || !me) return null;

  async function save() {
    setBusy(true);
    try {
      const data = await api<{ user: PublicUser }>('/api/users/me', {
        method: 'PATCH',
        body: {
          display_name: displayName.trim() || me!.display_name,
          custom_status: customStatus.trim() || null,
          bio: bio.trim() || null,
          status,
        },
      });
      setUser(data.user);
      await refreshFriends();
      pushToast(t('save') + ' ✓');
    } catch (error) {
      pushToast((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function pickAvatar(file: File | undefined) {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      pushToast(t('fileTypeNotAllowed'), 'error');
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      pushToast(t('fileTooLarge') + ' (256KB)', 'error');
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('read failed'));
      reader.readAsDataURL(file);
    });
    try {
      const data = await api<{ user: PublicUser }>('/api/users/me', {
        method: 'PATCH',
        body: { avatar_url: dataUrl },
      });
      setUser(data.user);
    } catch (error) {
      pushToast((error as Error).message, 'error');
    }
  }

  async function removeAvatar() {
    try {
      const data = await api<{ user: PublicUser }>('/api/users/me', { method: 'PATCH', body: { avatar_url: null } });
      setUser(data.user);
    } catch (error) {
      pushToast((error as Error).message, 'error');
    }
  }

  return (
    <Modal title={t('settings')} onClose={closeModal} width={520}>
      <div className="flex items-center gap-4">
        <Avatar user={me} size={72} />
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <button type="button" className="btn btn-secondary text-xs" onClick={() => fileRef.current?.click()}>
              {t('profile')} 📷
            </button>
            {me.avatar_url && (
              <button type="button" className="btn btn-ghost text-xs" onClick={() => void removeAvatar()}>
                {t('remove')}
              </button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              void pickAvatar(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <span className="text-xs text-[var(--text-muted)]">@{me.username}</span>
        </div>
      </div>

      <div className="mt-4 grid gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-[var(--text-secondary)]">{t('displayName')}</span>
          <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={64} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-[var(--text-secondary)]">{t('idle')} / Custom status</span>
          <input className="input" value={customStatus} onChange={(e) => setCustomStatus(e.target.value)} maxLength={128} placeholder="…" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-[var(--text-secondary)]">Bio</span>
          <textarea className="input min-h-16" value={bio} onChange={(e) => setBio(e.target.value)} maxLength={500} />
        </label>
        <div className="flex flex-wrap gap-2">
          {(['ONLINE', 'IDLE', 'DND', 'OFFLINE'] as UserStatus[]).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setStatus(value)}
              className="btn text-xs"
              style={{
                background: status === value ? 'var(--bg-elevated)' : 'transparent',
                border: `1px solid ${status === value ? 'var(--brand-primary)' : 'var(--border-subtle)'}`,
                color: 'var(--text-primary)',
              }}
            >
              {value === 'ONLINE' ? t('online') : value === 'IDLE' ? t('idle') : value === 'DND' ? t('dnd') : t('offline')}
            </button>
          ))}
        </div>

        <div className="border-t pt-3" style={{ borderColor: 'var(--border-subtle)' }}>
          <h3 className="mb-2 text-sm font-semibold">{t('appearance')}</h3>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-secondary text-xs" onClick={() => setTheme('dark')} style={{ borderColor: theme === 'dark' ? 'var(--brand-primary)' : undefined }}>
              🌙 {t('dark')}
            </button>
            <button type="button" className="btn btn-secondary text-xs" onClick={() => setTheme('light')} style={{ borderColor: theme === 'light' ? 'var(--brand-primary)' : undefined }}>
              ☀️ {t('light')}
            </button>
            <button type="button" className="btn btn-secondary text-xs" onClick={() => setLang(lang === 'fa' ? 'en' : 'fa')}>
              {t('language')}: {lang === 'fa' ? 'فارسی' : 'English'}
            </button>
          </div>
        </div>
      </div>

      <div className="mt-5 flex justify-end">
        <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy}>
          {t('save')}
        </button>
      </div>
    </Modal>
  );
}
