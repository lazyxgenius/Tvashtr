// Tvashtr marketing web app — nav, hero, surfaces, editorial band, footer.
function WebNav() {
  const { Button } = window.DesignSystem_dbaa69;
  return (
    <nav style={wb.nav}>
      <div style={wb.navInner}>
        <div style={wb.brand}>
          <img src="../../assets/logo/mark-coral.png" width="28" height="28" alt="" />
          <span style={wb.word}>Tvashtr</span>
        </div>
        <div style={wb.navLinks}>
          {['Product', 'Developers', 'Pricing', 'Field notes'].map((l) => (
            <a key={l} href="#" style={wb.navLink}>{l}</a>
          ))}
        </div>
        <div style={wb.navRight}>
          <Button variant="ghost" size="md">Sign in</Button>
          <Button variant="primary" size="md">Start a thread</Button>
        </div>
      </div>
    </nav>
  );
}

function WebHero() {
  const { Button, Badge } = window.DesignSystem_dbaa69;
  const I = window.TvIcons;
  return (
    <header style={wb.hero}>
      <img src="../../assets/logo/mark-coral.png" width="76" height="76" alt="" style={{ marginBottom: 26 }} />
      <div style={wb.eyebrow}>Tvashtr Labs</div>
      <h1 style={wb.h1}>A calmer way to<br />think out loud.</h1>
      <p style={wb.lead}>One quiet suite for the messy middle of knowledge work — chat, a developer CLI, a writing canvas, and an agent that picks your threads back up where you left them.</p>
      <div style={wb.heroCtas}>
        <Button variant="primary" size="lg" iconRight={<I.Arrow size={18} />}>Start a thread</Button>
        <Button variant="secondary" size="lg">Read the field notes</Button>
      </div>
      <div style={wb.heroMeta}><Badge variant="success" dot>No credit card</Badge><span style={wb.metaDim}>Free while it’s small · paper-light by design</span></div>
    </header>
  );
}

function SurfaceCard({ icon, name, tag, children }) {
  const { Card, Badge } = window.DesignSystem_dbaa69;
  return (
    <Card interactive>
      <div style={wb.surfTop}>
        <span style={wb.surfIcon}>{icon}</span>
        {tag && <Badge variant="outline">{tag}</Badge>}
      </div>
      <h3 style={wb.surfName}>{name}</h3>
      <p style={wb.surfDesc}>{children}</p>
    </Card>
  );
}

function WebSurfaces() {
  const I = window.TvIcons;
  return (
    <section style={wb.section}>
      <div style={wb.sectionHead}>
        <div style={wb.eyebrow}>The suite</div>
        <h2 style={wb.h2}>Five surfaces, one quiet grain</h2>
        <p style={wb.sectionLead}>The same warm paper, the same single accent, everywhere you work.</p>
      </div>
      <div style={wb.grid}>
        <SurfaceCard icon={<I.Message size={22} />} name="Chat" tag="Desktop">A thoughtful conversation that remembers the thread.</SurfaceCard>
        <SurfaceCard icon={<I.Terminal size={22} />} name="Weave CLI" tag="Developers">The loom in your terminal — build, ask, and ship.</SurfaceCard>
        <SurfaceCard icon={<I.Pen size={22} />} name="Canvas" tag="Web">A calm page for drafting, side by side with the agent.</SurfaceCard>
        <SurfaceCard icon={<I.Compass size={22} />} name="Agent" tag="Desktop">Quietly does the legwork across your files and tabs.</SurfaceCard>
        <SurfaceCard icon={<I.Layout size={22} />} name="Workspace" tag="Web">Everyone’s threads in one unhurried place.</SurfaceCard>
        <SurfaceCard icon={<I.Book size={22} />} name="Field notes" tag="Reading">How we think about calm, useful software.</SurfaceCard>
      </div>
    </section>
  );
}

function WebQuote() {
  return (
    <section style={wb.quoteBand}>
      <img src="../../assets/logo/mark-cream.png" width="44" height="44" alt="" style={{ opacity: 0.85, marginBottom: 22 }} />
      <p style={wb.quote}>“The best tools get quieter the more you trust them. Tvashtr is built to disappear into the work.”</p>
      <div style={wb.quoteBy}>Field notes · No. 4</div>
    </section>
  );
}

function WebFooter() {
  const cols = [
    { h: 'Product', items: ['Chat', 'Weave CLI', 'Canvas', 'Agent', 'Pricing'] },
    { h: 'Developers', items: ['Docs', 'API', 'Status', 'Changelog'] },
    { h: 'Company', items: ['Field notes', 'About', 'Careers', 'Contact'] },
  ];
  return (
    <footer style={wb.footer}>
      <div style={wb.footerInner}>
        <div style={wb.footerBrand}>
          <div style={wb.brand}><img src="../../assets/logo/mark-charcoal.png" width="26" height="26" alt="" /><span style={wb.word}>Tvashtr</span></div>
          <p style={wb.footerTag}>A calmer way to think out loud.</p>
        </div>
        <div style={wb.footerCols}>
          {cols.map((c) => (
            <div key={c.h}>
              <div style={wb.footerH}>{c.h}</div>
              {c.items.map((it) => <a key={it} href="#" style={wb.footerLink}>{it}</a>)}
            </div>
          ))}
        </div>
      </div>
      <div style={wb.footerBase}>
        <span>© 2026 Tvashtr Labs</span>
        <span style={wb.footerBaseRight}>Made unhurriedly · Privacy · Terms</span>
      </div>
    </footer>
  );
}

function WebKit() {
  return (
    <div style={wb.page}>
      <WebNav />
      <WebHero />
      <WebSurfaces />
      <WebQuote />
      <WebFooter />
    </div>
  );
}

const wb = {
  page: { background: 'var(--surface-page)', minHeight: '100%' },
  nav: { position: 'sticky', top: 0, zIndex: 10, background: 'color-mix(in srgb, var(--cream-100) 88%, transparent)', backdropFilter: 'blur(8px)', borderBottom: '1px solid var(--border-hairline)' },
  navInner: { maxWidth: 1120, margin: '0 auto', height: 66, padding: '0 28px', display: 'flex', alignItems: 'center', gap: 32 },
  brand: { display: 'flex', alignItems: 'center', gap: 9 },
  word: { fontFamily: 'var(--font-serif)', fontWeight: 400, fontSize: 21, letterSpacing: '-0.02em', color: 'var(--text-primary)' },
  navLinks: { display: 'flex', gap: 26, marginLeft: 8 },
  navLink: { fontFamily: 'var(--font-sans)', fontSize: 14.5, color: 'var(--text-secondary)', textDecoration: 'none' },
  navRight: { display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' },

  hero: { maxWidth: 760, margin: '0 auto', padding: '88px 28px 76px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' },
  eyebrow: { fontFamily: 'var(--font-sans)', fontSize: 12.5, fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--coral-600)' },
  h1: { fontFamily: 'var(--font-serif)', fontWeight: 400, fontSize: 60, lineHeight: 1.04, letterSpacing: '-0.025em', color: 'var(--text-primary)', margin: '16px 0 0', textWrap: 'balance' },
  lead: { fontFamily: 'var(--font-sans)', fontSize: 18.5, lineHeight: 1.6, color: 'var(--text-secondary)', maxWidth: 560, margin: '22px 0 0', textWrap: 'pretty' },
  heroCtas: { display: 'flex', gap: 12, marginTop: 34, flexWrap: 'wrap', justifyContent: 'center' },
  heroMeta: { display: 'flex', alignItems: 'center', gap: 12, marginTop: 24 },
  metaDim: { fontFamily: 'var(--font-sans)', fontSize: 13.5, color: 'var(--text-tertiary)' },

  section: { maxWidth: 1120, margin: '0 auto', padding: '40px 28px 88px' },
  sectionHead: { textAlign: 'center', maxWidth: 600, margin: '0 auto 44px' },
  h2: { fontFamily: 'var(--font-serif)', fontWeight: 400, fontSize: 38, lineHeight: 1.1, letterSpacing: '-0.02em', color: 'var(--text-primary)', margin: '12px 0 0' },
  sectionLead: { fontFamily: 'var(--font-sans)', fontSize: 16.5, color: 'var(--text-secondary)', margin: '14px 0 0', lineHeight: 1.6 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 18 },
  surfTop: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  surfIcon: { width: 44, height: 44, borderRadius: 'var(--radius-md)', background: 'var(--coral-100)', color: 'var(--coral-700)', display: 'grid', placeItems: 'center' },
  surfName: { fontFamily: 'var(--font-serif)', fontWeight: 400, fontSize: 22, letterSpacing: '-0.01em', color: 'var(--text-primary)', margin: '0 0 6px' },
  surfDesc: { fontFamily: 'var(--font-sans)', fontSize: 14.5, lineHeight: 1.55, color: 'var(--text-secondary)', margin: 0 },

  quoteBand: { background: 'var(--ink-900)', padding: '76px 28px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' },
  quote: { fontFamily: 'var(--font-serif)', fontWeight: 400, fontStyle: 'italic', fontSize: 30, lineHeight: 1.4, letterSpacing: '-0.01em', color: 'var(--cream-100)', maxWidth: 720, margin: 0, textWrap: 'balance' },
  quoteBy: { fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--stone-400)', marginTop: 24, letterSpacing: '0.02em' },

  footer: { maxWidth: 1120, margin: '0 auto', padding: '64px 28px 28px' },
  footerInner: { display: 'flex', justifyContent: 'space-between', gap: 40, flexWrap: 'wrap', paddingBottom: 40, borderBottom: '1px solid var(--border-hairline)' },
  footerBrand: { maxWidth: 280 },
  footerTag: { fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: 16, color: 'var(--text-secondary)', margin: '14px 0 0' },
  footerCols: { display: 'flex', gap: 56 },
  footerH: { fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 },
  footerLink: { display: 'block', fontFamily: 'var(--font-sans)', fontSize: 14, color: 'var(--text-secondary)', textDecoration: 'none', padding: '5px 0' },
  footerBase: { display: 'flex', justifyContent: 'space-between', paddingTop: 22, fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--text-tertiary)' },
  footerBaseRight: { color: 'var(--text-tertiary)' },
};
window.WebKit = WebKit;
