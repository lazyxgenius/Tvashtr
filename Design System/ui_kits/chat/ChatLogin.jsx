// Login screen for the Tvashtr chat app.
function ChatLogin({ onContinue }) {
  const { Button, Input, Logo } = window.DesignSystem_dbaa69;
  const [email, setEmail] = React.useState('ada@loomsandletters.co');
  return (
    <div style={cl.page}>
      <div style={cl.card}>
        <div style={cl.mark}>
          <img src="../../assets/logo/mark-coral.png" width="52" height="52" alt="Tvashtr" />
        </div>
        <h1 style={cl.title}>Welcome back</h1>
        <p style={cl.sub}>Pick up your threads where you left them.</p>
        <div style={cl.form}>
          <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Input label="Password" type="password" defaultValue="••••••••••" />
          <Button variant="primary" size="lg" fullWidth onClick={onContinue}>Continue</Button>
        </div>
        <div style={cl.divider}><span style={cl.dividerLine} /><span style={cl.dividerWord}>or</span><span style={cl.dividerLine} /></div>
        <Button variant="secondary" size="lg" fullWidth onClick={onContinue}>Continue with single sign-on</Button>
        <p style={cl.foot}>New to Tvashtr? <a href="#" style={cl.link} onClick={(e) => { e.preventDefault(); onContinue(); }}>Create a workspace</a></p>
      </div>
      <p style={cl.legal}>Tvashtr Labs · a calmer way to think out loud</p>
    </div>
  );
}

const cl = {
  page: { minHeight: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 24, padding: 40, boxSizing: 'border-box', background: 'var(--surface-page)' },
  card: { width: 'min(420px, 100%)', background: 'var(--surface-card)', border: '1px solid var(--border-hairline)', borderRadius: 'var(--radius-xl)', padding: '40px 40px 32px', boxShadow: 'var(--shadow-md)', display: 'flex', flexDirection: 'column', alignItems: 'center' },
  mark: { marginBottom: 18 },
  title: { fontFamily: 'var(--font-serif)', fontWeight: 400, fontSize: 30, letterSpacing: '-0.02em', color: 'var(--text-primary)', margin: 0 },
  sub: { fontFamily: 'var(--font-sans)', fontSize: 15, color: 'var(--text-secondary)', margin: '8px 0 26px', textAlign: 'center' },
  form: { display: 'flex', flexDirection: 'column', gap: 16, width: '100%' },
  divider: { display: 'flex', alignItems: 'center', gap: 12, width: '100%', margin: '20px 0' },
  dividerLine: { flex: 1, height: 1, background: 'var(--border-hairline)' },
  dividerWord: { fontFamily: 'var(--font-sans)', fontSize: 12, color: 'var(--text-tertiary)' },
  foot: { fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--text-secondary)', marginTop: 22 },
  link: { color: 'var(--text-link)', textDecoration: 'none', fontWeight: 500 },
  legal: { fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: 14, color: 'var(--text-tertiary)' },
};
window.ChatLogin = ChatLogin;
