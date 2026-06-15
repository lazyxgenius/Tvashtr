// Conversation pane: header, message list (with empty state) and composer.
function ChatMessage({ role, name, children }) {
  const { Avatar } = window.DesignSystem_dbaa69;
  const I = window.TvIcons;
  const isAgent = role === 'agent';
  return (
    <div style={cv.msg}>
      <div style={cv.msgHead}>
        {isAgent
          ? <span style={cv.agentAvatar}><img src="../../assets/logo/mark-coral.png" width="20" height="20" alt="" /></span>
          : <Avatar name={name} size="sm" />}
        <span style={cv.msgName}>{isAgent ? 'Tvashtr' : name}</span>
      </div>
      <div style={cv.msgBody}>{children}</div>
      {isAgent && (
        <div style={cv.msgTools}>
          <button style={cv.tool}><I.Copy size={15} /></button>
          <button style={cv.tool}><I.Refresh size={15} /></button>
          <button style={cv.tool}><I.ThumbUp size={15} /></button>
        </div>
      )}
    </div>
  );
}

function ChatComposer({ onSend }) {
  const { IconButton } = window.DesignSystem_dbaa69;
  const I = window.TvIcons;
  const [val, setVal] = React.useState('');
  const send = () => { if (val.trim()) { onSend(val.trim()); setVal(''); } };
  return (
    <div style={cv.composerWrap}>
      <div style={cv.composer}>
        <textarea value={val} onChange={(e) => setVal(e.target.value)} rows={1}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Ask anything, or pick a thread back up…" style={cv.textarea} />
        <div style={cv.composerBar}>
          <div style={cv.composerLeft}>
            <button style={cv.chip}><I.Paperclip size={16} /></button>
            <button style={cv.modelChip}><I.Sparkles size={15} /> Tvashtr Loom <I.Chevron size={14} /></button>
          </div>
          <IconButton variant="solid" aria-label="Send" onClick={send}><I.ArrowUp size={18} /></IconButton>
        </div>
      </div>
      <p style={cv.hint}>Tvashtr can be wrong. Keep your own copy of anything important.</p>
    </div>
  );
}

function ChatConversation({ thread, onSend }) {
  const I = window.TvIcons;
  const scroller = React.useRef(null);
  React.useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread]);
  const empty = thread.messages.length === 0;
  return (
    <section style={cv.root}>
      <header style={cv.header}>
        <div style={cv.headerTitle}>{thread.title}</div>
        <div style={cv.headerActions}>
          <button style={cv.tool}><I.Book size={18} /></button>
          <button style={cv.tool}><I.More size={18} /></button>
        </div>
      </header>
      <div ref={scroller} style={cv.scroll}>
        {empty ? (
          <div style={cv.empty}>
            <img src="../../assets/logo/mark-charcoal.png" width="64" height="64" alt="" style={{ opacity: 0.5 }} />
            <h2 style={cv.emptyTitle}>What are you working on?</h2>
            <p style={cv.emptySub}>Start a thread and it’ll appear on the loom. Tvashtr keeps the context so you can pick it back up later.</p>
            <div style={cv.suggests}>
              {['Draft a warm release note', 'Explain this stack trace', 'Plan a quiet launch'].map((s) => (
                <button key={s} style={cv.suggest} onClick={() => onSend(s)}>{s}</button>
              ))}
            </div>
          </div>
        ) : (
          <div style={cv.thread}>
            {thread.messages.map((m, i) => (
              <ChatMessage key={i} role={m.role} name={m.name}>{m.text}</ChatMessage>
            ))}
          </div>
        )}
      </div>
      <ChatComposer onSend={onSend} />
    </section>
  );
}

const cv = {
  root: { flex: 1, display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0, background: 'var(--surface-page)' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 26px', height: 60, borderBottom: '1px solid var(--border-hairline)', flex: 'none' },
  headerTitle: { fontFamily: 'var(--font-serif)', fontWeight: 400, fontSize: 19, letterSpacing: '-0.01em', color: 'var(--text-primary)' },
  headerActions: { display: 'flex', gap: 4, color: 'var(--text-tertiary)' },
  tool: { width: 34, height: 34, display: 'grid', placeItems: 'center', border: 'none', background: 'transparent', color: 'inherit', borderRadius: 'var(--radius-sm)', cursor: 'pointer' },
  scroll: { flex: 1, overflowY: 'auto', padding: '8px 0' },
  thread: { maxWidth: 720, margin: '0 auto', padding: '24px' },
  msg: { padding: '18px 0', borderBottom: '1px solid var(--border-faint)' },
  msgHead: { display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10 },
  agentAvatar: { width: 28, height: 28, borderRadius: '50%', background: 'var(--coral-100)', border: '1px solid var(--coral-200)', display: 'grid', placeItems: 'center', flex: 'none' },
  msgName: { fontFamily: 'var(--font-sans)', fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)' },
  msgBody: { fontFamily: 'var(--font-sans)', fontSize: 15.5, lineHeight: 1.62, color: 'var(--text-primary)', paddingLeft: 37, whiteSpace: 'pre-wrap' },
  msgTools: { display: 'flex', gap: 2, paddingLeft: 33, marginTop: 8, color: 'var(--text-tertiary)' },
  empty: { maxWidth: 560, margin: '0 auto', minHeight: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '40px 24px' },
  emptyTitle: { fontFamily: 'var(--font-serif)', fontWeight: 400, fontSize: 30, letterSpacing: '-0.02em', color: 'var(--text-primary)', margin: '20px 0 8px' },
  emptySub: { fontFamily: 'var(--font-sans)', fontSize: 15, color: 'var(--text-secondary)', lineHeight: 1.6, maxWidth: 420, margin: 0 },
  suggests: { display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center', marginTop: 26 },
  suggest: { fontFamily: 'var(--font-sans)', fontSize: 13.5, color: 'var(--text-primary)', background: 'var(--cream-50)', border: '1px solid var(--border-hairline)', borderRadius: 'var(--radius-pill)', padding: '8px 15px', cursor: 'pointer' },
  composerWrap: { padding: '12px 24px 18px', flex: 'none' },
  composer: { maxWidth: 720, margin: '0 auto', background: 'var(--cream-50)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-lg)', padding: 12, boxShadow: 'var(--shadow-sm)' },
  textarea: { width: '100%', border: 'none', background: 'transparent', outline: 'none', resize: 'none', fontFamily: 'var(--font-sans)', fontSize: 15.5, lineHeight: 1.5, color: 'var(--text-primary)', padding: '6px 8px', boxSizing: 'border-box' },
  composerBar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  composerLeft: { display: 'flex', alignItems: 'center', gap: 8 },
  chip: { width: 34, height: 34, display: 'grid', placeItems: 'center', border: '1px solid var(--border-hairline)', background: 'transparent', color: 'var(--text-secondary)', borderRadius: 'var(--radius-sm)', cursor: 'pointer' },
  modelChip: { display: 'flex', alignItems: 'center', gap: 6, height: 34, padding: '0 12px', border: '1px solid var(--border-hairline)', background: 'transparent', color: 'var(--text-secondary)', borderRadius: 'var(--radius-pill)', cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: 13 },
  hint: { maxWidth: 720, margin: '8px auto 0', textAlign: 'center', fontFamily: 'var(--font-sans)', fontSize: 12, color: 'var(--text-tertiary)' },
};
window.ChatConversation = ChatConversation;
