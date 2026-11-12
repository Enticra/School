import { useEffect, useState } from 'react';
import { TEMPLATE_LABELS, render, type ModuleKey, type NotifyKey, type School, type SchoolSettings } from '@enticra/core';
import { Crest, Icon, Loading, PageHead, Seg, Switch, onColor, readImage, relTime, useAction, useApp, useLoad } from '../ui';

const MODULES: Record<ModuleKey, string> = { attendance: 'Attendance', homework: 'Homework', exams: 'Tests and marks', aiGrading: 'AI correction', profiles: 'Student profiles', reports: 'Report cards' };

export function Settings() {
  const { api, session, refreshSession, toast } = useApp();
  const { data: school } = useLoad(() => api.getSchool(), []);
  const audit = useLoad(() => api.listAudit(), []);
  const staff = useLoad(() => api.listStaff(), []);
  const [draft, setDraft] = useState<School | null>(null);
  const [newType, setNewType] = useState('');
  const { run, busy } = useAction();
  useEffect(() => { if (school) setDraft(structuredClone(school)); }, [school]);
  if (!draft || !school) return <Loading />;

  const b = draft.branding;
  const s = draft.settings;
  const setB = (patch: Partial<School['branding']>) => setDraft({ ...draft, branding: { ...b, ...patch } });
  const setS = (patch: Partial<SchoolSettings>) => setDraft({ ...draft, settings: { ...s, ...patch } });
  const dirty = JSON.stringify(draft) !== JSON.stringify(school);

  const save = async () => {
    const r = await run(() => api.updateSchool({ name: draft.name, shortName: draft.shortName, branding: draft.branding, settings: draft.settings }), (r) => `Saved. Settings version ${r.settings.version}.`);
    if (r) await refreshSession();
  };

  return (
    <>
      <PageHead title="Settings and branding" lede="One platform, set up the way your school works. Every change is versioned and logged.">
        <span className="pill">Version {school.settings.version}</span>
        <button className="btn ghost" disabled={!dirty} onClick={() => setDraft(structuredClone(school))}>Discard</button>
        <button className="btn" disabled={!dirty || busy} onClick={save}>Save changes</button>
      </PageHead>

      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <section className="card stack" style={{ gap: 14 }}>
          <h2>Branding</h2>
          <div className="preview-strip" style={{ ['--pv-primary' as string]: b.primary, ['--pv-on' as string]: onColor(b.primary) }}>
            <div className="top"><Crest school={draft} /><div><b style={{ fontFamily: 'var(--display)' }}>{draft.shortName}</b><div className="small" style={{ opacity: .75 }}>{b.motto || s.board}</div></div></div>
            <div className="bottom"><span className="btn sm" style={{ background: b.accent, color: onColor(b.accent) }}>Save and notify parents</span><span className="muted small">How your portal and report cards will look</span></div>
          </div>
          <div className="field"><label htmlFor="s-name">School name</label><input id="s-name" className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></div>
          <div className="grid cols-2" style={{ gap: 12 }}>
            <div className="field"><label htmlFor="s-short">Short name (used in messages)</label><input id="s-short" className="input" value={draft.shortName} onChange={(e) => setDraft({ ...draft, shortName: e.target.value })} /></div>
            <div className="field"><label htmlFor="s-crest">Crest letters</label><input id="s-crest" className="input" maxLength={3} value={b.crest} onChange={(e) => setB({ crest: e.target.value.toUpperCase() })} /></div>
          </div>
          <div className="row" style={{ gap: 20 }}>
            <div className="field"><label htmlFor="s-primary">Main colour</label><div className="row"><input id="s-primary" type="color" className="swatch" value={b.primary} onChange={(e) => setB({ primary: e.target.value })} /><code className="small">{b.primary}</code></div></div>
            <div className="field"><label htmlFor="s-accent">Accent colour</label><div className="row"><input id="s-accent" type="color" className="swatch" value={b.accent} onChange={(e) => setB({ accent: e.target.value })} /><code className="small">{b.accent}</code></div></div>
            <div className="field"><span className="label">Logo</span>
              <div className="row">
                <label className="btn sm ghost" style={{ cursor: 'pointer' }}><input type="file" accept="image/*" className="sr" onChange={async (e) => { const f = e.target.files?.[0]; if (f) try { setB({ logoDataUrl: await readImage(f, 256) }); } catch (err) { toast((err as Error).message, 'err'); } }} /><Icon name="upload" size={16} />Upload</label>
                {b.logoDataUrl && <button className="btn sm ghost" onClick={() => setB({ logoDataUrl: undefined })}>Remove</button>}
              </div>
            </div>
          </div>
          <div className="field"><label htmlFor="s-motto">Motto</label><input id="s-motto" className="input" value={b.motto} onChange={(e) => setB({ motto: e.target.value })} /></div>
          <div className="field"><label htmlFor="s-lh">Letterhead line on report cards</label><input id="s-lh" className="input" value={b.letterhead} onChange={(e) => setB({ letterhead: e.target.value })} /></div>
        </section>

        <section className="card stack" style={{ gap: 14 }}>
          <h2>Parent messages</h2>
          <div className="row between"><span>Default language</span><Seg label="Language" value={s.language} onChange={(v) => setS({ language: v })} options={[{ value: 'en', label: 'English' }, { value: 'ta', label: 'தமிழ்' }]} /></div>
          <div className="row between"><span>Quiet hours (messages wait until morning)</span>
            <div className="row"><input aria-label="Quiet hours start" type="time" className="input" style={{ width: 140 }} value={s.quietHours.start} onChange={(e) => setS({ quietHours: { ...s.quietHours, start: e.target.value } })} /><span className="dim">to</span><input aria-label="Quiet hours end" type="time" className="input" style={{ width: 140 }} value={s.quietHours.end} onChange={(e) => setS({ quietHours: { ...s.quietHours, end: e.target.value } })} /></div>
          </div>
          <div className="list">
            {(Object.keys(TEMPLATE_LABELS) as NotifyKey[]).map((k) => (
              <div key={k} className="stack" style={{ gap: 6 }}>
                <div className="row between"><b>{TEMPLATE_LABELS[k]}</b><Switch label={`Send ${TEMPLATE_LABELS[k]} messages`} checked={s.notify[k]} onChange={(v) => setS({ notify: { ...s.notify, [k]: v } })} /></div>
                {s.notify[k] && <p className="small muted" lang={s.language}>{render(k, s.language, { student: 'Arun', school: draft.shortName, time: '08:24', date: 'today', subject: 'Maths', title: 'Exercise 7.2', due: 'Friday', exam: 'Unit Test 2', marks: 42, max: 50, grade: 'A2' })}</p>}
              </div>
            ))}
          </div>
          <p className="hint">Each message wording is submitted to WhatsApp for approval once, under your school’s name.</p>
        </section>

        <section className="card stack" style={{ gap: 14 }}>
          <h2>Academics</h2>
          <div className="row between"><span>Board</span><Seg label="Board" value={s.board} onChange={(v) => setS({ board: v })} options={(['TN State Board', 'Matriculation', 'CBSE', 'ICSE'] as const).map((x) => ({ value: x, label: x }))} /></div>
          <div className="field"><span className="label">Exam types</span>
            <div className="chip-list">{s.examTypes.map((t) => <span key={t} className="pill">{t}<button aria-label={`Remove ${t}`} style={{ all: 'unset', cursor: 'pointer', marginLeft: 2 }} onClick={() => setS({ examTypes: s.examTypes.filter((x) => x !== t) })}>×</button></span>)}</div>
            <div className="row" style={{ flexWrap: 'nowrap' }}><input aria-label="New exam type" className="input" placeholder="Add an exam type" value={newType} onChange={(e) => setNewType(e.target.value)} /><button className="btn sm quiet" disabled={!newType.trim()} onClick={() => { setS({ examTypes: [...s.examTypes, newType.trim()] }); setNewType(''); }}>Add</button></div>
          </div>
          <div className="field"><span className="label">Grading scale</span>
            <div className="table-wrap"><table className="table"><thead><tr><th>From %</th><th>Grade</th><th>Remark</th></tr></thead><tbody>
              {s.gradingScale.map((g, i) => (
                <tr key={i}>
                  <td><input aria-label="Minimum percent" className="mark-input" style={{ width: 64 }} value={g.min} onChange={(e) => setS({ gradingScale: s.gradingScale.map((x, j) => (j === i ? { ...x, min: Number(e.target.value) || 0 } : x)) })} /></td>
                  <td><input aria-label="Grade" className="mark-input" style={{ width: 64 }} value={g.grade} onChange={(e) => setS({ gradingScale: s.gradingScale.map((x, j) => (j === i ? { ...x, grade: e.target.value } : x)) })} /></td>
                  <td><input aria-label="Remark" className="input" style={{ height: 34 }} value={g.remark} onChange={(e) => setS({ gradingScale: s.gradingScale.map((x, j) => (j === i ? { ...x, remark: e.target.value } : x)) })} /></td>
                </tr>
              ))}
            </tbody></table></div>
          </div>
          <div className="row between"><span>Pass mark</span><div className="row"><input aria-label="Pass mark" className="mark-input" value={s.passMark} onChange={(e) => setS({ passMark: Number(e.target.value) || 0 })} /><span className="dim">%</span></div></div>
          <div className="row between"><span>AI marking policy</span><Seg label="Marking policy" value={s.markingPolicy} onChange={(v) => setS({ markingPolicy: v })} options={[{ value: 'board', label: 'Board-strict' }, { value: 'school', label: 'School mode' }]} /></div>
          <p className="hint">{s.markingPolicy === 'board' ? 'Marks exactly like a board examiner: every step and unit counts.' : 'Forgives a missing unit or formula line when the final answer is right.'}</p>
          <div className="row between"><span>Flag AI marks for review below</span><div className="row"><input aria-label="Review threshold" type="range" min={50} max={95} step={5} value={Math.round(s.aiConfidenceThreshold * 100)} onChange={(e) => setS({ aiConfidenceThreshold: Number(e.target.value) / 100 })} /><span className="num" style={{ width: 40 }}>{Math.round(s.aiConfidenceThreshold * 100)}%</span></div></div>
        </section>

        <section className="card stack" style={{ gap: 14 }}>
          <h2>Attendance and modules</h2>
          <div className="row between"><span>Attendance</span><Seg label="Attendance mode" value={s.attendanceMode} onChange={(v) => setS({ attendanceMode: v })} options={[{ value: 'daily', label: 'Once a day' }, { value: 'session', label: 'Morning and afternoon' }]} /></div>
          <div className="row between"><label htmlFor="s-late">Late after</label><input id="s-late" type="time" className="input" style={{ width: 140 }} value={s.lateCutoff} onChange={(e) => setS({ lateCutoff: e.target.value })} /></div>
          <div className="list">
            {(Object.keys(MODULES) as ModuleKey[]).map((m) => (
              <div key={m} className="row between"><span>{MODULES[m]}</span><Switch label={`Turn ${MODULES[m]} on or off`} checked={s.modules[m]} onChange={(v) => setS({ modules: { ...s.modules, [m]: v } })} /></div>
            ))}
          </div>
          <p className="hint">Switch off what you don’t use; it disappears for teachers and parents.</p>
        </section>
      </div>

      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="card-head"><h2>Staff</h2><span className="dim small">Phone number is the login</span></div>
          <div className="list">{staff.data?.map((u) => <div key={u.id} className="row between"><span><b>{u.name}</b><div className="dim small">{u.title}</div></span><span className="dim small num">+91 {u.phone}</span></div>)}</div>
        </div>
        <div className="card">
          <div className="card-head"><h2>Activity log</h2><span className="dim small">Who changed what</span></div>
          <div className="list">{audit.data?.slice(0, 10).map((a) => <div key={a.id}><p className="small">{a.detail}</p><p className="dim small">{a.actor} · {relTime(a.at)}</p></div>)}</div>
        </div>
      </div>
      {session.user.role === 'principal' && <p className="dim small">Data for {school.name} is kept separate from every other school on Enticra School.</p>}
    </>
  );
}
