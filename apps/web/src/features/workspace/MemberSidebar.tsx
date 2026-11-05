import { useMemo } from 'react';
import { useDataStore } from '../../stores/data';
import { useUiStore } from '../../stores/ui';
import { Avatar } from '../../components/ui';
import type { MemberDto } from '../../lib/types';

function memberDisplayName(member: MemberDto): string {
  return member.nickname || member.user.display_name;
}

export function MemberSidebar() {
  const servers = useDataStore((s) => s.servers);
  const activeServerId = useDataStore((s) => s.activeServerId);
  const membersByServer = useDataStore((s) => s.membersByServer);
  const rolesByServer = useDataStore((s) => s.rolesByServer);
  const presence = useDataStore((s) => s.presence);
  const openModal = useUiStore((s) => s.openModal);

  const members = membersByServer[activeServerId ?? ''] ?? [];
  const roles = rolesByServer[activeServerId ?? ''] ?? [];
  const server = servers.find((s) => s.id === activeServerId);

  const grouped = useMemo(() => {
    const online = members.filter((m) => presence[m.user.id]);
    const offline = members.filter((m) => !presence[m.user.id]);
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
        onClick={() => openModal('userProfile', member.user.id)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-start transition-colors hover:bg-[var(--bg-elevated)]"
        style={{ opacity: dim ? 0.45 : 1 }}
      >
        <Avatar user={member.user} size={30} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm" style={{ color: topRole?.color ?? 'var(--text-primary)' }}>
            {memberDisplayName(member)}
          </span>
          {member.user.custom_status && (
            <span className="block truncate text-[11px] text-[var(--text-muted)]">{member.user.custom_status}</span>
          )}
        </span>
        {server?.owner_id === member.user.id && (
          <span className="text-[10px] text-[var(--brand-accent)]" title="Owner">
            ★
          </span>
        )}
      </button>
    );
  }

  return (
    <aside className="w-60 shrink-0 overflow-y-auto px-2 py-4" style={{ background: 'var(--bg-sidebar)' }}>
      <section className="mb-4">
        <h2 className="mb-1 px-2 text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
          Online — {grouped.online.length}
        </h2>
        {grouped.online.map((member) => renderMember(member, false))}
      </section>
      {grouped.offline.length > 0 && (
        <section>
          <h2 className="mb-1 px-2 text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
            Offline — {grouped.offline.length}
          </h2>
          {grouped.offline.map((member) => renderMember(member, true))}
        </section>
      )}
    </aside>
  );
}
