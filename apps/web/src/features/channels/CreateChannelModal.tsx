import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n';
import { api } from '../../lib/api';
import { useAuthStore } from '../../stores/auth';
import { useDataStore } from '../../stores/data';
import { useUiStore } from '../../stores/ui';
import { Modal } from '../../components/ui';
import type { PublicUser } from '../../lib/types';

export function CreateChannelModal() {
  const { t } = useI18n();
  const modal = useUiStore((s) => s.modal);
  const closeModal = useUiStore((s) => s.closeModal);
  const pushToast = useUiStore((s) => s.pushToast);
  const servers = useDataStore((s) => s.servers);
  const activeServerId = useDataStore((s) => s.activeServerId);
  const loadServerDetail = useDataStore((s) => s.loadServerDetail);
  const members = useDataStore((s) => s.membersByServer[activeServerId ?? ''] ?? []);
  const me = useAuthStore((s) => s.user);

  const [name, setName] = useState('');
  const [type, setType] = useState<'TEXT' | 'VOICE'>('TEXT');
  const [isPrivate, setIsPrivate] = useState(false);
  const [grants, setGrants] = useState<string[]>([]);
  const [editId, setEditId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const server = servers.find((s) => s.id === activeServerId);
  const editChannel = editId ? server?.channels?.find((c) => c.id === editId) : null;

  // Reuse the modal for editing: 'createChannel' + modalArg = channelId
  useEffect(() => {
    if (modal === 'createChannel') {
      const arg = useUiStore.getState().modalArg;
      setEditId(arg);
      setGrants([]);
      setName('');
      setIsPrivate(false);
      if (arg) {
        const channel = servers.find((s) => s.id === activeServerId)?.channels?.find((c) => c.id === arg);
        if (channel) {
          setName(channel.name);
          setType(channel.type);
          setIsPrivate(channel.is_private);
          void api<{ access_user_ids: string[] }>(`/api/channels/${arg}/access`)
            .then((data) => setGrants(data.access_user_ids))
            .catch(() => undefined);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modal]);

  if (modal !== 'createChannel' || !server || !me) return null;

  const memberUsers: PublicUser[] = members.filter((m) => m.user_id !== server.owner_id).map((m) => m.user);

  async function submit() {
    if (!server || !name.trim() || busy) return;
    const targetServer = server;
    setBusy(true);
    try {
      if (editId) {
        await api(`/api/channels/${editId}`, {
          method: 'PATCH',
          body: {
            name: name.trim(),
            ...(type === editChannel?.type ? {} : { type }),
            ...(isPrivate ? { access_user_ids: grants } : {}),
          },
        });
      } else {
        await api(`/api/servers/${targetServer.id}/channels`, {
          method: 'POST',
          body: {
            name: name.trim(),
            type,
            is_private: isPrivate,
            ...(isPrivate ? { access_user_ids: grants } : {}),
          },
        });
      }
      await loadServerDetail(targetServer.id);
      closeModal();
    } catch (error) {
      pushToast((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function removeChannel() {
    if (!server || !editId) return;
    if (!window.confirm(t('deleteChannel') + '?')) return;
    const targetServer = server;
    try {
      await api(`/api/channels/${editId}`, { method: 'DELETE' });
      await loadServerDetail(targetServer.id);
      closeModal();
    } catch (error) {
      pushToast((error as Error).message, 'error');
    }
  }

  return (
    <Modal title={editId ? t('edit') : t('createChannel')} onClose={closeModal}>
      <div className="grid gap-4">
        <div className="grid grid-cols-2 gap-2">
          {(['TEXT', 'VOICE'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setType(value)}
              className="btn btn-secondary"
              style={{ borderColor: type === value ? 'var(--brand-primary)' : undefined }}
            >
              {value === 'TEXT' ? `# ${t('textChannels')}` : `🔊 ${t('voiceChannels')}`}
            </button>
          ))}
        </div>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-[var(--text-secondary)]">{t('channelName')}</span>
          <input className="input" dir="auto" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoFocus />
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
          {t('privateChannel')}
        </label>

        {isPrivate && (
          <div className="max-h-48 overflow-y-auto rounded-[var(--radius)] p-2" style={{ background: 'var(--bg-input)' }}>
            <p className="mb-2 text-xs text-[var(--text-muted)]">{t('allowedMembers')}</p>
            {memberUsers.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)]">—</p>
            ) : (
              memberUsers.map((user) => (
                <label key={user.id} className="flex items-center gap-2 px-1 py-1 text-sm">
                  <input
                    type="checkbox"
                    checked={grants.includes(user.id)}
                    onChange={(e) =>
                      setGrants((prev) => (e.target.checked ? [...prev, user.id] : prev.filter((id) => id !== user.id)))
                    }
                  />
                  {user.display_name}
                </label>
              ))
            )}
          </div>
        )}

        <div className="flex justify-between">
          <div>
            {editId && editChannel && (
              <button type="button" className="btn btn-danger text-xs" onClick={() => void removeChannel()}>
                {t('deleteChannel')}
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn btn-secondary" onClick={closeModal}>
              {t('cancel')}
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy || !name.trim()}>
              {t('save')}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
