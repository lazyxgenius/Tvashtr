// Tvashtr CLI — interactive terminal in a paper window chrome.
const TERM_INTRO = [
  { type: 'sys', text: 'tvashtr weave · v0.4.1 — the loom is warm' },
  { type: 'sys', text: 'Type a command, or “help”. Try: weave build, chat "…", threads' },
  { type: 'spacer' },
  { type: 'prompt', text: 'weave build' },
  { type: 'dim', text: '# spinning up the loom…' },
  { type: 'ok', text: '✓ wove 14 threads in 1.2s' },
  { type: 'spacer' },
  { type: 'prompt', text: 'chat "make this error message kinder"' },
  { type: 'agent', text: 'Tvashtr  Try: “That address doesn’t look right — mind checking it?”\n         Warm, specific, and it tells them what to do next.' },
  { type: 'spacer' },
];

function runCommand(cmd) {
  const c = cmd.trim();
  if (!c) return [];
  const lines = [{ type: 'prompt', text: c }];
  const word = c.split(' ')[0];
  if (word === 'help') {
    lines.push({ type: 'out', text: 'commands:  weave build · chat "…" · threads · status · clear' });
  } else if (word === 'weave') {
    lines.push({ type: 'dim', text: '# spinning up the loom…' });
    lines.push({ type: 'ok', text: '✓ wove 14 threads in 1.1s' });
  } else if (word === 'threads') {
    lines.push({ type: 'out', text: '  t1  release note, warmer tone     · today' });
    lines.push({ type: 'out', text: '  t2  stack trace on weave build    · today' });
    lines.push({ type: 'out', text: '  t3  planning a quiet launch       · this week' });
  } else if (word === 'status') {
    lines.push({ type: 'ok', text: '● connected' });
    lines.push({ type: 'out', text: '  model   Tvashtr Loom' });
    lines.push({ type: 'out', text: '  ctx     4 threads · 12k tokens' });
  } else if (word === 'chat') {
    const m = c.match(/"([^"]*)"/);
    lines.push({ type: 'agent', text: 'Tvashtr  ' + (m ? 'On it — here’s a calm first pass:\n         “' + m[1].replace(/^./, (s) => s.toUpperCase()) + '” — kept plain and unhurried.' : 'Tell me what to work on, in quotes.') });
  } else if (word === 'clear') {
    return 'CLEAR';
  } else {
    lines.push({ type: 'err', text: 'unknown command: ' + word + '  — try “help”' });
  }
  return lines;
}

function TermLine({ line }) {
  if (line.type === 'spacer') return <div style={{ height: 10 }} />;
  const map = {
    sys: tm.sys, dim: tm.dim, ok: tm.ok, err: tm.err, out: tm.out, agent: tm.agent,
  };
  if (line.type === 'prompt') {
    return <div style={tm.line}><span style={tm.ps}>tvashtr ~</span><span style={tm.cmd}>{line.text}</span></div>;
  }
  return <div style={{ ...tm.line, ...map[line.type] }}>{line.text}</div>;
}

function TerminalKit() {
  const I = window.TvIcons;
  const [lines, setLines] = React.useState(TERM_INTRO);
  const [val, setVal] = React.useState('');
  const bodyRef = React.useRef(null);
  const inputRef = React.useRef(null);
  React.useEffect(() => { const el = bodyRef.current; if (el) el.scrollTop = el.scrollHeight; }, [lines]);

  const submit = (e) => {
    e.preventDefault();
    const res = runCommand(val);
    if (res === 'CLEAR') { setLines([]); setVal(''); return; }
    if (res.length) setLines((p) => [...p, ...res, { type: 'spacer' }]);
    setVal('');
  };

  return (
    <div style={tm.page}>
      <div style={tm.window}>
        <header style={tm.titlebar}>
          <div style={tm.lights}><span style={{ ...tm.dot, background: '#D98C76' }} /><span style={{ ...tm.dot, background: '#D9C07A' }} /><span style={{ ...tm.dot, background: '#9DBE86' }} /></div>
          <div style={tm.tabs}>
            <span style={tm.tabActive}><I.Terminal size={14} /> weave</span>
            <span style={tm.tab}>logs</span>
          </div>
          <div style={tm.titleRight}><img src="../../assets/logo/mark-charcoal.png" width="18" height="18" alt="" /></div>
        </header>
        <div ref={bodyRef} style={tm.body} onClick={() => inputRef.current && inputRef.current.focus()}>
          {lines.map((l, i) => <TermLine key={i} line={l} />)}
          <form onSubmit={submit} style={tm.inputRow}>
            <span style={tm.ps}>tvashtr ~</span>
            <input ref={inputRef} value={val} onChange={(e) => setVal(e.target.value)} style={tm.input}
              spellCheck={false} autoComplete="off" placeholder="type a command…" autoFocus />
          </form>
        </div>
        <footer style={tm.statusbar}>
          <span style={tm.stItem}><span style={tm.stDot} /> connected</span>
          <span style={tm.stItem}>Tvashtr Loom</span>
          <span style={{ flex: 1 }} />
          <span style={tm.stDim}>⏎ run · “clear” to reset</span>
        </footer>
      </div>
    </div>
  );
}

const MONO = 'var(--font-mono)';
const tm = {
  page: { minHeight: '100%', display: 'grid', placeItems: 'center', padding: 40, boxSizing: 'border-box', background: 'var(--surface-page)' },
  window: { width: 'min(860px, 100%)', height: 'min(620px, 86vh)', display: 'flex', flexDirection: 'column', borderRadius: 'var(--radius-lg)', overflow: 'hidden', border: '1px solid var(--border-strong)', boxShadow: 'var(--shadow-lg)', background: 'var(--ink-900)' },
  titlebar: { display: 'flex', alignItems: 'center', gap: 16, height: 44, padding: '0 14px', background: 'var(--cream-100)', borderBottom: '1px solid var(--border-hairline)', flex: 'none' },
  lights: { display: 'flex', gap: 8 },
  dot: { width: 12, height: 12, borderRadius: '50%' },
  tabs: { display: 'flex', gap: 6, alignItems: 'center' },
  tab: { fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--text-tertiary)', padding: '4px 10px' },
  tabActive: { display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', padding: '4px 10px', background: 'var(--panel-300)', borderRadius: 'var(--radius-sm)' },
  titleRight: { marginLeft: 'auto', opacity: 0.7 },
  body: { flex: 1, overflowY: 'auto', padding: '18px 20px', fontFamily: MONO, fontSize: 13.5, lineHeight: 1.7, color: 'var(--cream-100)', cursor: 'text' },
  line: { whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  ps: { color: 'var(--coral-500)', marginRight: 10, flex: 'none' },
  cmd: { color: 'var(--cream-100)' },
  sys: { color: 'var(--stone-400)' },
  dim: { color: '#8A8780' },
  ok: { color: 'var(--sage-500)' },
  err: { color: '#E0917F' },
  out: { color: '#D9D6CC' },
  agent: { color: 'var(--blue-500)', whiteSpace: 'pre-wrap' },
  inputRow: { display: 'flex', alignItems: 'center', marginTop: 2 },
  input: { flex: 1, border: 'none', background: 'transparent', outline: 'none', fontFamily: MONO, fontSize: 13.5, color: 'var(--cream-100)', caretColor: 'var(--coral-500)' },
  statusbar: { display: 'flex', alignItems: 'center', gap: 16, height: 30, padding: '0 16px', background: 'var(--ink-800)', borderTop: '1px solid var(--ink-700)', flex: 'none', fontFamily: MONO, fontSize: 11.5, color: 'var(--stone-400)' },
  stItem: { display: 'inline-flex', alignItems: 'center', gap: 6 },
  stDot: { width: 7, height: 7, borderRadius: '50%', background: 'var(--sage-500)' },
  stDim: { color: '#6E6B61' },
};
window.TerminalKit = TerminalKit;
