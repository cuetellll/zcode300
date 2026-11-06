import { useMemo } from 'react';
import { X } from 'lucide-react';
import { useI18n } from '../../i18n';
import { useDataStore } from '../../stores/data';
import { useUiStore } from '../../stores/ui';
import { Avatar } from '../../components/ui';
import type { MemberDto } from '../../lib/types';

function memberDisplayName(member: MemberDto): string {
  return member.nickname || member.user.display_name;
}

/** Right-hand member list: online / offline groups, collapsible on desktop and
 * a slide-over drawer on mobile (the backdrop is owned by AppShell). */
export function MemberSidebar() {
  const { t } = useI18n();
  const servers = useDataStore((s) => s.servers);
  const activeServerId = useDataStore((s) => s.activeServerId);
  const membersByServer = useDataStore((s) => s.membersByServer);
  const rolesByServer = useDataStore((s) => s.rolesByServer);
  const presence = useDataStore((s) => s.presence);
  const openModal = useUiStore((s) => s.openModal);
  const setMemberSidebarOpen = useUiStore((s) => s.setMemberSidebarOpen);

  const members = membersByServer[activeServerId ?? ''] ?? [];
  const roles = rolesByServer[activeServerId ?? ''] ?? [];
  const server = servers.find((s) => s.id === activeServerId);

  const grouped = useMemo(() => {
    const online = members.filter((member) => presence[member.user.id]);
    const offline = members.filter((member) => !presence[member.user.id]);
    return { online, offline };
  }, [members, presence]);

  if (!server) return null;

  function renderMember(member: MemberDto, dim: boolean) {
    const topRole = roles
      .filter((role) => member.role_ids.includes(role.id) && role.hoist)
      .sort((a, b) => b.position - a.position)[0];
    return (
      <button
        key={member.id}
        type="button"
        onClick={() => {
          openModal('userProfile', member.user.id);
          setMemberSidebarOpen(false);
        }}
        className="flex w-full items-center gap-2 rounded px-2 py-1 text-start transition-colors hover:bg-[var(--bg-elevated)]"
        style={{ opacity: dim ? 0.4 : 1 }}
      >
        <Avatar user={member.user} size={32} showStatus dimmed={dim} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium" style={{ color: topRole?.color ?? 'var(--text-primary)' }}>
            {memberDisplayName(member)}
          </span>
          {member.user.custom_status && (
            <span className="block truncate text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {member.user.custom_status}
            </span>
          )}
        </span>
        {server?.owner_id === member.user.id && (
          <span className="text-[10px]" style={{ color: 'var(--brand-accent)' }} title={t('owner')}>
            ★
          </span>
        )}
      </button>
    );
  }

  return (
    <aside
      className="fixed inset-y-0 end-0 z-40 flex w-[240px] shrink-0 flex-col md:static md:z-auto"
      style={{ background: 'var(--bg-sidebar)' }}
    >
      <div className="flex h-12 shrink-0 items-center justify-between px-2.5 md:hidden">
        <span className="text-sm font-semibold">{t('membersList')}</span>
        <button type="button" className="icon-btn h-7 w-7" onClick={() => setMemberSidebarOpen(false)} aria-label={t('close')}>
          <X size={16} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        <section className="mb-4">
          <h2 className="section-title">{t('online')} — {grouped.online.length}</h2>
          {grouped.online.map((member) => renderMember(member, false))}
          {grouped.online.length === 0 && (
            <p className="px-2 py-1 text-xs" style={{ color: 'var(--text-muted)' }}>
              {t('offline')}
            </p>
          )}
        </section>
        {grouped.offline.length > 0 && (
          <section>
            <h2 className="section-title">{t('offline')} — {grouped.offline.length}</h2>
            {grouped.offline.map((member) => renderMember(member, true))}
          </section>
        )}
      </div>
    </aside>
  );
}
