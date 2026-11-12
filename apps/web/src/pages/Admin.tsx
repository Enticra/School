import { useState } from 'react';
import { formatDate, type SchoolSettings } from '@enticra/core';
import { Crest, EnticraLogo, Icon, Loading, Modal, PageHead, Seg, useAction, useApp, useLoad } from '../ui';

const MODULE_NAMES: Record<string, string> = { attendance: 'Attendance', homework: 'Homework', exams: 'Tests', aiGrading: 'AI correction', profiles: 'Profiles', reports: 'Reports' };

export function Admin() {
  const { api } = useApp();
  const { data } = useLoad(() => api.listSchools(), []);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', shortName: '', board: 'Matriculation' as SchoolSettings['board'], principalName: '', principalPhone: '', primary: '#0B333B', accent: '#E26527', language: 'en' as 'en' | 'ta' });
  const [created, setCreated] = useState<{ name: string; phone: string } | null>(null);
  const { run, busy } = useAction();
  if (!data) return <Loading />;
  const totals = { schools: data.length, students: data.reduce((t, s) => t + s.students, 0), messages: data.reduce((t, s) => t + s.messages, 0) };

  return (
    <>
      <PageHead eyebrow={<span className="row" style={{ gap: 8 }}><EnticraLogo className="" />platform</span>} title="Schools on Enticra School" lede="One codebase, configured per school. Each school is its own tenant with its own branding, rules and data.">
        <button className="btn" onClick={() => { setOpen(true); setCreated(null); }}><Icon name="plus" size={18} />Add a school</button>
      </PageHead>
      <div className="grid cols-3">
        <div className="card stat"><span className="eyebrow">Schools</span><span className="value">{totals.schools}</span></div>
        <div className="card stat"><span className="eyebrow">Students</span><span className="value">{totals.students}</span></div>
        <div className="card stat"><span className="eyebrow">Parent messages</span><span className="value">{totals.messages}</span></div>
      </div>
      <div className="grid cols-2">
        {data.map((s) => (
          <div key={s.id} className="card stack" style={{ gap: 14 }}>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <Crest school={s} />
              <div style={{ minWidth: 0 }}><h3>{s.name}</h3><p className="dim small">{s.settings.board} · since {formatDate(s.createdAt.slice(0, 10))}</p></div>
              <span className="pill accent" style={{ marginLeft: 'auto' }}>{s.plan}</span>
            </div>
            <div className="row" style={{ gap: 6 }}>
              <span style={{ width: 22, height: 22, borderRadius: 6, background: s.branding.primary }} title={`Main ${s.branding.primary}`} />
              <span style={{ width: 22, height: 22, borderRadius: 6, background: s.branding.accent }} title={`Accent ${s.branding.accent}`} />
              <span className="dim small">{s.settings.language === 'ta' ? 'Tamil first' : 'English first'} · {s.settings.attendanceMode === 'session' ? 'two sessions' : 'daily'} attendance · {s.settings.markingPolicy === 'board' ? 'board-strict' : 'school'} marking</span>
            </div>
            <div className="chip-list">{Object.entries(s.settings.modules).map(([k, on]) => <span key={k} className={`pill ${on ? 'ok' : ''}`}>{on ? '✓' : '–'} {MODULE_NAMES[k]}</span>)}</div>
            <div className="grid cols-3 small">
              <div><span className="eyebrow">Students</span><div className="num" style={{ fontSize: '1.2rem' }}>{s.students}</div></div>
              <div><span className="eyebrow">Staff</span><div className="num" style={{ fontSize: '1.2rem' }}>{s.staff}</div></div>
              <div><span className="eyebrow">Messages</span><div className="num" style={{ fontSize: '1.2rem' }}>{s.messages}</div></div>
            </div>
          </div>
        ))}
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Add a school">
        {created ? (
          <div className="stack" style={{ gap: 14 }}>
            <p><b>{created.name}</b> is set up with default settings. The principal signs in with <b>+91 {created.phone}</b> and finishes branding, exam types and messages in Settings.</p>
            <p className="muted small">Next in onboarding: import students from Excel or EMIS, then submit WhatsApp templates for approval.</p>
            <button className="btn" onClick={() => setOpen(false)}>Done</button>
          </div>
        ) : (
          <form className="stack" style={{ gap: 12 }} onSubmit={async (e) => { e.preventDefault(); const r = await run(() => api.createSchool(form), 'School created.'); if (r) setCreated({ name: r.school.name, phone: r.principal.phone }); }}>
            <div className="field"><label htmlFor="a-name">School name</label><input id="a-name" className="input" placeholder="Green Valley Matriculation School" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="grid cols-2" style={{ gap: 12 }}>
              <div className="field"><label htmlFor="a-short">Short name</label><input id="a-short" className="input" placeholder="Green Valley" value={form.shortName} onChange={(e) => setForm({ ...form, shortName: e.target.value })} /></div>
              <div className="field"><span className="label">Board</span><select aria-label="Board" className="input" value={form.board} onChange={(e) => setForm({ ...form, board: e.target.value as SchoolSettings['board'] })}>{['TN State Board', 'Matriculation', 'CBSE', 'ICSE'].map((b) => <option key={b}>{b}</option>)}</select></div>
              <div className="field"><label htmlFor="a-pn">Principal’s name</label><input id="a-pn" className="input" value={form.principalName} onChange={(e) => setForm({ ...form, principalName: e.target.value })} /></div>
              <div className="field"><label htmlFor="a-pp">Principal’s mobile</label><input id="a-pp" className="input" inputMode="numeric" value={form.principalPhone} onChange={(e) => setForm({ ...form, principalPhone: e.target.value })} /></div>
            </div>
            <div className="row" style={{ gap: 20 }}>
              <div className="field"><label htmlFor="a-c1">Main colour</label><input id="a-c1" type="color" className="swatch" value={form.primary} onChange={(e) => setForm({ ...form, primary: e.target.value })} /></div>
              <div className="field"><label htmlFor="a-c2">Accent</label><input id="a-c2" type="color" className="swatch" value={form.accent} onChange={(e) => setForm({ ...form, accent: e.target.value })} /></div>
              <div className="field"><span className="label">Messages in</span><Seg label="Language" value={form.language} onChange={(v) => setForm({ ...form, language: v })} options={[{ value: 'en', label: 'English' }, { value: 'ta', label: 'தமிழ்' }]} /></div>
            </div>
            <button className="btn" disabled={busy}>Create school</button>
          </form>
        )}
      </Modal>
    </>
  );
}
