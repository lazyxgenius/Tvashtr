// Left sidebar: brand, new thread, search, grouped thread list, account.
function ChatSidebar({ threads, activeId, onSelect, onNew }) {
  const { Button, Avatar } = window.DesignSystem_dbaa69;
  const I = window.TvIcons;
  const groups = [
    { label: 'Today', items: threads.filter((t) => t.group === 'today') },
    { label: 'Earlier this week', items: threads.filter((t) => t.group === 'week') },
  ];
  return (
    <aside style={sb.root}>
      <div style={sb.top}>
        <div style={sb.brand}>
          <img src="../../assets/logo/mark-coral.png" width="26" height="26" alt="" />
          <span style={sb.word}>Tvashtr</span>
        </div>
      </div>
      <div style={sb.actions}>
        <Button variant="primary" size="md" fullWidth iconLeft={<I.Pen size={17} />} onClick={onNew}>New thread</Button>
        <div style={sb.search}>
          <I.Search size={16} />
          <input placeholder="Search threads" style={sb.searchInput} />
        </div>
      </div>
      <nav style={sb.list}>
        {groups.map((g) => g.items.length > 0 && (
          <div key={g.label} style={sb.group}>
            <div style={sb.groupLabel}>{g.label}</div>
            {g.items.map((t) => {
              const active = t.id === activeId;
              return (
                <button key={t.id} onClick={() => onSelect(t.id)}
                  style={{ ...sb.item, ...(active ? sb.itemActive : null) }}>
                  <span style={sb.itemTitle}>{t.title}</span>
                  <span style={sb.itemMeta}>{t.preview}</span>
                </button>
              );
            })}
          </div>
        ))}
      </nav>
      <div style={sb.account}>
        <Avatar name="Ada Lovelace" size="sm" />
        <div style={sb.accountText}>
          <span style={sb.accountName}>Ada Lovelace</span>
          <span style={sb.accountPlan}>Studio plan</span>
        </div>
        <I.Settings size={18} />
      </div>
    </aside>
  );
}

const sb = {
  root: { width: 284, flex: 'none', background: 'var(--surface-panel)', borderRight: '1px solid var(--border-hairline)', display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box' },
  top: { padding: '18px 20px 8px' },
  brand: { display: 'flex', alignItems: 'center', gap: 9 },
  word: { fontFamily: 'var(--font-serif)', fontWeight: 400, fontSize: 20, letterSpacing: '-0.02em', color: 'var(--text-primary)' },
  actions: { padding: '8px 16px 14px', display: 'flex', flexDirection: 'column', gap: 10 },
  search: { display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', height: 38, background: 'var(--cream-50)', border: '1px solid var(--border-hairline)', borderRadius: 'var(--radius-md)', color: 'var(--text-tertiary)' },
  searchInput: { border: 'none', background: 'transparent', outline: 'none', fontFamily: 'var(--font-sans)', fontSize: 14, color: 'var(--text-primary)', width: '100%' },
  list: { flex: 1, overflowY: 'auto', padding: '4px 12px 12px' },
  group: { marginBottom: 14 },
  groupLabel: { fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 500, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-tertiary)', padding: '8px 10px 6px' },
  item: { display: 'flex', flexDirection: 'column', gap: 2, width: '100%', textAlign: 'left', padding: '9px 11px', border: '1px solid transparent', borderRadius: 'var(--radius-md)', background: 'transparent', cursor: 'pointer', marginBottom: 2 },
  itemActive: { background: 'var(--cream-50)', borderColor: 'var(--border-hairline)' },
  itemTitle: { fontFamily: 'var(--font-sans)', fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  itemMeta: { fontFamily: 'var(--font-sans)', fontSize: 12.5, color: 'var(--text-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  account: { display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderTop: '1px solid var(--border-hairline)', color: 'var(--text-tertiary)' },
  accountText: { display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 },
  accountName: { fontFamily: 'var(--font-sans)', fontSize: 13.5, fontWeight: 500, color: 'var(--text-primary)' },
  accountPlan: { fontFamily: 'var(--font-sans)', fontSize: 12, color: 'var(--text-tertiary)' },
};
window.ChatSidebar = ChatSidebar;
