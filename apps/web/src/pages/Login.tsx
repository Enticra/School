import { useEffect, useState } from 'react';
import { backend, DEMO, type Config, type Session } from '../api';
import { EnticraLogo, Icon, initials } from '../ui';

const ROLE_LABEL: Record<string, string> = { principal: 'Principal', teacher: 'Teacher', parent: 'Parent', student: 'Student', enticra_admin: 'Enticra admin' };

export function Login({ onSignedIn, theme, setTheme }: { onSignedIn: (s: Session) => void; theme: 'light' | 'dark'; setTheme: (t: 'light' | 'dark') => void }) {
  const [config, setConfig] = useState<Config | null>(null);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { backend.config().then(setConfig).catch(() => setConfig({ devMode: false, grader: 'mock', demoAccounts: [] })); }, []);

  const request = async (p = phone) => {
    setError('');
    if (p.replace(/\D/g, '').length < 10) { setError('Enter your 10-digit mobile number.'); return; }
    setBusy(true);
    try { await backend.requestCode(p); setStep('code'); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const verify = async (p = phone, c = code) => {
    setError('');
    setBusy(true);
    try { onSignedIn(await backend.verify(p, c)); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const quick = async (p: string) => {
    setPhone(p);
    await backend.requestCode(p);
    await verify(p, '123456');
  };

  return (
    <div className="login">
      <section className="login-stage">
        <div className="row between">
          <div className="row" style={{ gap: 12, alignItems: 'center' }}>
            <EnticraLogo className="logo" />
            <span style={{ fontFamily: 'var(--display)', fontSize: '1.35rem', letterSpacing: '-.03em', color: '#A3BEC1', marginTop: 4 }}>school</span>
          </div>
          <button className="icon-btn" style={{ color: '#ECF4F4' }} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Switch theme"><Icon name={theme === 'dark' ? 'sun' : 'moon'} /></button>
        </div>
        <h1>Less correcting. <em>More teaching.</em></h1>
        <p className="lede">Attendance, AI paper correction, analytics, fees, transport and the office in one place. Parents get every update on WhatsApp, in Tamil or English.</p>
        <div className="scene" aria-label="Sample WhatsApp messages a parent receives">
          <div className="bubble">Arun reached school at 08:24 today. – Sri Vidya Matric<div className="meta">8:25 am ✓✓</div></div>
          <div className="bubble" lang="ta">அருண் இன்றைய Maths வீட்டுப்பாடம்: Exercise 7.2, sums 1 to 6. – Sri Vidya Matric<div className="meta">3:31 pm ✓✓</div></div>
          <div className="bubble">Arun scored 11.5/15 in Revision Test 1 (Maths). Answer-wise feedback is on the parent page.<div className="meta">6:02 pm ✓✓</div></div>
          <span className="small" style={{ color: '#7A979B' }}>Sample messages</span>
        </div>
        <div className="ribbon" aria-hidden="true"><span>Every parent informed</span><span>✦</span><span>Every paper marked by morning</span><span>✦</span><span>Software that fits how you work</span></div>
      </section>

      <section className="login-form">
        <div className="login-card">
          <div>
            <div className="eyebrow" style={{ marginBottom: 8 }}>Sign in</div>
            <h2 style={{ fontSize: '1.7rem' }}>Welcome back</h2>
            <p className="muted" style={{ marginTop: 6 }}>Use the mobile number your school has on record. We’ll send a 6-digit code on WhatsApp.</p>
          </div>
          {step === 'phone' ? (
            <form className="stack" onSubmit={(e) => { e.preventDefault(); void request(); }}>
              <div className="field">
                <label htmlFor="phone">Mobile number</label>
                <div className="row" style={{ flexWrap: 'nowrap' }}>
                  <span className="input" style={{ width: 64, display: 'grid', placeItems: 'center', flex: 'none' }}>+91</span>
                  <input id="phone" className="input" inputMode="numeric" autoComplete="tel-national" placeholder="98400 11111" value={phone} onChange={(e) => setPhone(e.target.value)} />
                </div>
              </div>
              {error && <p className="error-text" role="alert">{error}</p>}
              <button className="btn lg" disabled={busy}>Send code<span className="chip"><Icon name="arrow" size={16} /></span></button>
            </form>
          ) : (
            <form className="stack" onSubmit={(e) => { e.preventDefault(); void verify(); }}>
              <div className="field">
                <label htmlFor="code">6-digit code sent to +91 {phone}</label>
                <input id="code" className="input num" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} style={{ letterSpacing: '.4em', fontSize: '1.2rem', height: 52 }} autoFocus />
                {config?.devMode && <span className="hint">Demo code: 123456</span>}
              </div>
              {error && <p className="error-text" role="alert">{error}</p>}
              <button className="btn lg" disabled={busy || code.length !== 6}>Sign in</button>
              <button type="button" className="btn ghost" onClick={() => { setStep('phone'); setCode(''); setError(''); }}>Use another number</button>
            </form>
          )}

          {config?.devMode && config.demoAccounts.length > 0 && (
            <div className="stack" style={{ marginTop: 8 }}>
              <div className="row between"><span className="eyebrow">Sample accounts</span><span className="dim small">{DEMO ? 'Runs in your browser' : 'Dev mode'}</span></div>
              <div className="accounts">
                {config.demoAccounts.map((a) => (
                  <button key={a.phone} className="account" onClick={() => void quick(a.phone)} disabled={busy}>
                    <span className="avatar">{initials(a.name)}</span>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: 'block', fontWeight: 650 }}>{a.name}</span>
                      <span className="dim small">{ROLE_LABEL[a.role]} · {a.school}</span>
                    </span>
                    <Icon name="arrow" size={18} />
                  </button>
                ))}
              </div>
            </div>
          )}
          <p className="dim small">Enticra School by <a href="https://enticra.com" target="_blank" rel="noreferrer">enticra.com</a> · contactus@enticra.com</p>
        </div>
      </section>
    </div>
  );
}
