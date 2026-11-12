import { useState } from 'react';
import { formatDate, isoDate, type Activity } from '@enticra/core';
import { Bar, Icon, Loading, Modal, PageHead, Seg, Sparkline, initials, useAction, useApp, useConfirm, useLoad } from '../ui';
import { AddStudentModal, ImportStudents } from '../showcase/School';

export function Students() {
  const { api, go, session } = useApp();
  const [classId, setClassId] = useState('all');
  const [std, setStd] = useState('all');
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [q, setQ] = useState('');
  const [former, setFormer] = useState(false);
  const classes = useLoad(() => api.listClasses(), []);
  const list = useLoad(() => api.listStudents(), []);
  const left = useLoad(() => (session.user.role === 'principal' || session.user.role === 'teacher' ? api.listFormerStudents() : Promise.resolve([])), []);
  // The principal views; class advisors add, edit, move and restore their own students.
  const viewOnly = session.user.role === 'principal';
  const { run, busy } = useAction();
  if (!classes.data || !list.data) return <Loading />;
  const gradeOf = new Map(classes.data.map((c) => [c.id, c.grade]));
  const inStd = (id: string) => std === 'all' || String(gradeOf.get(id)) === std;
  const rows = list.data.filter((s) => inStd(s.classId) && (classId === 'all' || s.classId === classId) && (!q || s.name.toLowerCase().includes(q.toLowerCase())));
  const canAdd = classes.data.filter((c) => c.classTeacherId === session.user.id);
  const grades = [...new Set(classes.data.map((c) => c.grade))].sort((a, b) => b - a);

  return (
    <>
      <PageHead title="Students" lede={viewOnly ? 'Every student by standard and class, with marks, attendance, activities and interests. Class advisors add and update their own students.' : 'Marks, attendance, activities and interests in one profile for every child.'}>
        {(left.data?.length ?? 0) > 0 && <button className="btn ghost" onClick={() => setFormer(true)}>Former students ({left.data!.length})</button>}
        {canAdd.length > 0 && <button className="btn ghost" onClick={() => setImporting(true)}><Icon name="upload" size={18} />Import from Excel</button>}
        {canAdd.length > 0 && <button className="btn" onClick={() => setAdding(true)}><Icon name="plus" size={18} />Add student</button>}
      </PageHead>
      <Modal open={former} onClose={() => setFormer(false)} title="Former students" wide>
        <p className="dim small" style={{ marginBottom: 10 }}>Students who left the school. Their sign-in and their family’s are deactivated; marks, attendance and report cards are kept. Restoring brings them back to their class and turns their sign-in on again.</p>
        {!left.data?.length ? <div className="empty">No former students.</div> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Student</th><th>Class</th><th>Left on</th><th>Reason</th><th>Sign-in</th><th /></tr></thead>
            <tbody>{left.data.map((f) => (
              <tr key={f.id}><td><b>{f.name}</b><div className="dim small">Removed by {f.by}</div></td><td>{f.classLabel}</td><td>{formatDate(f.leftOn)}</td><td className="small">{f.reason}</td><td><span className="pill">{f.signInsClosed ? 'Deactivated' : 'Closed'}</span></td>
                <td>{!viewOnly && <button className="btn sm ghost" disabled={busy} onClick={() => void run(() => api.restoreStudent(f.id), (x) => `${x.name} is back in ${x.classLabel} as roll ${x.rollNo}.`)}>Restore</button>}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </Modal>
      {session.user.role === 'teacher' && canAdd.length > 0 && <p className="dim small">You can add students to {canAdd.map((c) => c.label).join(' and ')}, the class you are class advisor of.</p>}
      <Modal open={importing} onClose={() => { setImporting(false); list.reload(); }} title={`Import students into ${canAdd.map((c) => c.label).join(' and ')}`} wide><ImportStudents /></Modal>
      <AddStudentModal open={adding} onClose={() => setAdding(false)} classes={canAdd} />
      <div className="card">
        <div className="card-head">
          <div className="row">
            {grades.length > 1 && <><label className="sr" htmlFor="stu-g">Standard</label><select id="stu-g" className="input" style={{ width: 'auto' }} value={std} onChange={(e) => { setStd(e.target.value); setClassId('all'); }}><option value="all">All standards</option>{grades.map((g) => <option key={g} value={g}>Standard {g}</option>)}</select></>}
            <label className="sr" htmlFor="stu-c">Class</label><select id="stu-c" className="input" style={{ width: 'auto' }} value={classId} onChange={(e) => setClassId(e.target.value)}><option value="all">All classes</option>{classes.data.filter((c) => inStd(c.id)).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
            <label className="sr" htmlFor="stu-q">Search students</label>
            <input id="stu-q" className="input" style={{ width: 220 }} placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <span className="dim small">{rows.length} students</span>
        </div>
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Student</th><th>Class</th><th>Parent</th><th style={{ width: '18%' }}>Attendance</th><th style={{ width: '18%' }}>Average</th></tr></thead>
          <tbody>{rows.map((s) => (
            <tr key={s.id} className="click" onClick={() => go({ page: 'students', id: s.id })}>
              <td><div className="row" style={{ flexWrap: 'nowrap' }}><span className="avatar">{initials(s.name)}</span><div><b>{s.name}</b><div className="dim small">Roll {s.rollNo} · EMIS {s.emis}</div></div></div></td>
              <td>{s.classLabel}</td>
              <td className="small">{s.guardian.name}<div className="dim">+91 {s.guardian.phone}{!s.consent.whatsapp && ' · no WhatsApp consent'}</div></td>
              <td><Bar value={s.attendancePct} label="" thresholds={[75, 90]} /></td>
              <td>{s.average === null ? '–' : <Bar value={s.average} label="" thresholds={[45, 60]} />}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </div>
    </>
  );
}

const KINDS: Activity['kind'][] = ['Art', 'Music', 'Dance', 'Sports', 'Club', 'Competition', 'Other'];

export function StudentProfile({ id, embedded }: { id: string; embedded?: boolean }) {
  const { api, go, session } = useApp();
  const { data } = useLoad(() => api.getStudent(id), [id]);
  const { run, busy } = useAction();
  const [adding, setAdding] = useState(false);
  const [act, setAct] = useState<Omit<Activity, 'id'>>({ kind: 'Art', title: '', detail: '', date: '' });
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [why, setWhy] = useState({ reason: 'Transfer certificate issued', other: '', leftOn: isoDate(new Date()) });
  const [ask, confirmEl] = useConfirm();
  const classes = useLoad(() => (session.user.role === 'principal' || session.user.role === 'teacher' ? api.listClasses() : Promise.resolve([])), []);
  if (!data || !classes.data) return <Loading />;
  const { student: s } = data;
  // Teachers add activities and notes; the class advisor edits, moves within the standard, or removes. The principal views.
  const staff = session.user.role === 'teacher';
  const manage = classes.data.some((c) => c.id === s.classId && c.classTeacherId === session.user.id);
  const editClasses = data.sections.map((x) => ({ ...(classes.data!.find((c) => c.id === s.classId) ?? classes.data![0]), id: x.id, label: x.label }));
  const remove = async () => {
    const reason = why.reason === 'Other' ? why.other.trim() : why.reason;
    if (!reason) return;
    // Leave the profile before the data refresh, or it reloads a student who is no longer on the roll.
    const r = await run(() => api.removeStudent(s.id, { reason, leftOn: why.leftOn }).then((x) => { setRemoving(false); go({ page: 'students' }); return x; }), (x) => `${x.removed} removed from ${x.classLabel}. Sign-in deactivated for ${x.signInsClosed.length ? x.signInsClosed.join(' and ') : 'the student'}${x.signInsKept.length ? `; ${x.signInsKept.join(', ')} keeps theirs` : ''}.`);
    void r;
  };
  const bySubject: Record<string, { label: string; value: number }[]> = {};
  for (const r of data.results) if (r.pct !== null) (bySubject[r.subject] ??= []).push({ label: r.name, value: r.pct });
  const latest = Object.entries(bySubject).map(([subject, pts]) => ({ subject, value: pts.at(-1)!.value, pts }));

  return (
    <>
      {confirmEl}
      {!embedded && (
        <div className="row between">
          <button className="btn sm ghost" onClick={() => go({ page: 'students' })}><Icon name="back" size={16} />All students</button>
          {manage && <span className="row" style={{ gap: 6 }}><button className="btn sm ghost" onClick={() => setEditing(true)}><Icon name="pen" size={16} />Edit details</button><button className="btn sm quiet" onClick={() => setRemoving(true)}>Leaving school</button></span>}
        </div>
      )}
      {manage && <AddStudentModal open={editing} onClose={() => setEditing(false)} classes={editClasses} student={s} />}
      <Modal open={removing} onClose={() => setRemoving(false)} title={`${s.name} is leaving the school`}>
        <form className="stack" style={{ gap: 12 }} onSubmit={(e) => { e.preventDefault(); void remove(); }}>
          <div className="small stack" style={{ gap: 6 }}>
            <span>What happens when you confirm:</span>
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              <li><b>{s.name}’s student sign-in is deactivated at once.</b> The parent’s sign-in is deactivated too, unless they have another child in the school.</li>
              <li>They leave {data.classLabel}’s roll list, attendance register and exam seating. No more WhatsApp messages go to the family.</li>
              <li>Marks, attendance and every report card are kept. Issue the transfer certificate from Certificates.</li>
              <li>If this was a mistake, restore them from <b>Former students</b>; their sign-in works again.</li>
            </ul>
          </div>
          <div className="field"><label htmlFor="rm-r">Reason</label><select id="rm-r" className="input" value={why.reason} onChange={(e) => setWhy({ ...why, reason: e.target.value })}>{['Transfer certificate issued', 'Moved to another town', 'Completed 12th standard', 'Left the school', 'Added by mistake', 'Other'].map((x) => <option key={x}>{x}</option>)}</select></div>
          {why.reason === 'Other' && <div className="field"><label htmlFor="rm-o">Say why</label><input id="rm-o" className="input" value={why.other} onChange={(e) => setWhy({ ...why, other: e.target.value })} /></div>}
          <div className="field"><label htmlFor="rm-d">Last day</label><input id="rm-d" type="date" className="input" style={{ width: 180 }} max={isoDate(new Date())} value={why.leftOn} onChange={(e) => setWhy({ ...why, leftOn: e.target.value })} /></div>
          <div className="row"><button className="btn danger" disabled={busy || (why.reason === 'Other' && !why.other.trim())}>Deactivate and remove from class</button><button type="button" className="btn ghost" onClick={() => setRemoving(false)}>Cancel</button></div>
        </form>
      </Modal>
      <div className="card row" style={{ gap: 18, flexWrap: 'wrap' }}>
        <span className="avatar" style={{ width: 64, height: 64, fontSize: '1.2rem' }}>{initials(s.name)}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1 style={{ fontSize: '1.7rem' }}>{s.name}</h1>
          <p className="muted" style={{ marginTop: 6 }}>Class {data.classLabel} · Roll {s.rollNo} · Class advisor {data.classTeacher} · Parent {s.guardian.name} (+91 {s.guardian.phone})</p>
          {data.risk.length > 0 && <div className="chip-list" style={{ marginTop: 8 }}>{data.risk.map((r) => <span key={r} className="pill bad"><Icon name="alert" size={14} />{r}</span>)}</div>}
        </div>
        <div className="row">
          <div className="stat"><span className="eyebrow">Attendance</span><span className="value">{data.attendance.pct}<small>%</small></span></div>
        </div>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <div className="card-head"><h2>Marks by subject</h2><span className="dim small">Latest test, trend across tests</span></div>
          <div className="list">
            {latest.map((l) => (
              <div key={l.subject} className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) 120px', gap: 12, alignItems: 'center' }}>
                <Bar value={l.value} label={l.subject} thresholds={[45, 60]} />
                <Sparkline points={l.pts} />
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h2>Chapters</h2><span className="dim small">Where marks are lost</span></div>
          <div className="stack" style={{ gap: 12 }}>
            {data.chapters.slice(0, 4).map((c) => <Bar key={c.chapter} value={c.pct} label={c.chapter} />)}
            <div className="eyebrow" style={{ marginTop: 6 }}>Strongest</div>
            {data.chapters.slice(-3).reverse().map((c) => <Bar key={c.chapter} value={c.pct} label={c.chapter} />)}
          </div>
        </div>
      </div>

      {data.feedback.length > 0 && (
        <div className="card">
          <div className="card-head"><h2>Answer-wise feedback</h2><span className="dim small">From corrected scripts, approved by the teacher</span></div>
          {data.feedback.map(({ script, exam }) => (
            <div key={script.id} className="stack">
              <b>{exam.subject} · {exam.name}: {script.responses.reduce((t, r) => t + (r.teacherMarks ?? r.aiMarks), 0)}/{exam.questions.reduce((t, q) => t + q.maxMarks, 0)}</b>
              <div className="grid cols-2" style={{ gap: 10 }}>
                {script.responses.map((r) => (
                  <div key={r.no} className="qcard" style={{ padding: 12 }}>
                    <div className="row between"><b>Q{r.no} · {exam.questions.find((q) => q.no === r.no)?.chapter}</b><span className="num"><b>{r.teacherMarks ?? r.aiMarks}</b>/{r.maxMarks}</span></div>
                    <p className="small muted">{r.feedback || 'Full marks.'}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid cols-2">
        <div className="card">
          <div className="card-head"><h2>Activities and achievements</h2>{staff && <button className="btn sm ghost" onClick={() => setAdding(true)}><Icon name="plus" size={16} />Add</button>}</div>
          {s.activities.length === 0 ? <div className="empty">No activities yet. Art, music, sport and clubs count toward the future guidance report.</div> : (
            <div className="tl">{s.activities.map((a) => <div key={a.id}><span className="pill">{a.kind}</span><div style={{ flex: 1 }}><b>{a.title}</b><div className="muted small">{a.detail} · {formatDate(a.date)}</div></div>{staff && <button className="btn sm quiet" aria-label={`Remove ${a.title}`} onClick={async () => { if (await ask({ title: `Remove “${a.title}”?`, body: 'It is taken off this student’s profile and future guidance report.', confirm: 'Remove', danger: true })) void run(() => api.removeActivity(s.id, a.id), 'Activity removed.'); }}>Remove</button>}</div>)}</div>
          )}
          <div className="eyebrow" style={{ marginTop: 16, marginBottom: 8 }}>Interests</div>
          <div className="chip-list">{s.interests.length ? s.interests.map((i) => <span key={i} className="pill accent">{i}</span>) : <span className="dim small">Not recorded yet</span>}</div>
        </div>
        <div className="card">
          <div className="card-head"><h2>Attendance</h2><span className="dim small">Last {data.attendance.recent.length} school days</span></div>
          <div className="cal" role="img" aria-label={`Absent on ${data.attendance.absent.length} days, late ${data.attendance.late} times`}>
            {data.attendance.recent.map((d) => <i key={d.date} data-m={d.mark} title={`${formatDate(d.date)}: ${d.mark === 'A' ? 'Absent' : d.mark === 'L' ? 'Late' : 'Present'}`} />)}
          </div>
          <div className="row small muted" style={{ marginTop: 10 }}><span className="pill ok">Present</span><span className="pill warn">Late {data.attendance.late}</span><span className="pill bad">Absent {data.attendance.absent.length}</span></div>
          {staff && (
            <>
              <div className="eyebrow" style={{ marginTop: 18, marginBottom: 8 }}>Teacher observations</div>
              <div className="list">{s.observations.map((o, i) => <div key={i} className="row between" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}><div><p className="small">{o.text}</p><p className="dim small">{o.by} · {formatDate(o.date)}</p></div>{staff && o.by === session.user.name && <button className="btn sm quiet" aria-label="Remove observation" onClick={async () => { if (await ask({ title: 'Remove this observation?', body: o.text, confirm: 'Remove', danger: true })) void run(() => api.removeObservation(s.id, i), 'Observation removed.'); }}>Remove</button>}</div>)}</div>
              <div className="row" style={{ marginTop: 10, flexWrap: 'nowrap' }}>
                <label className="sr" htmlFor="obs">Add an observation</label>
                <input id="obs" className="input" placeholder="Add an observation for this term" value={note} onChange={(e) => setNote(e.target.value)} />
                <button className="btn sm" disabled={!note.trim() || busy} onClick={async () => { if (await run(() => api.addObservation(s.id, note), 'Observation saved.')) setNote(''); }}>Save</button>
              </div>
            </>
          )}
        </div>
      </div>

      <Modal open={adding} onClose={() => setAdding(false)} title="Add activity">
        <div className="stack" style={{ gap: 12 }}>
          <div className="field"><span className="label">Kind</span><Seg label="Kind" value={act.kind} onChange={(k) => setAct({ ...act, kind: k })} options={KINDS.map((k) => ({ value: k, label: k }))} /></div>
          <div className="field"><label htmlFor="act-title">Title</label><input id="act-title" className="input" placeholder="District chess tournament" value={act.title} onChange={(e) => setAct({ ...act, title: e.target.value })} /></div>
          <div className="field"><label htmlFor="act-detail">Detail</label><input id="act-detail" className="input" placeholder="Third place, under-16" value={act.detail} onChange={(e) => setAct({ ...act, detail: e.target.value })} /></div>
          <div className="field"><label htmlFor="act-date">Date</label><input id="act-date" type="date" className="input" value={act.date} onChange={(e) => setAct({ ...act, date: e.target.value })} /></div>
          <button className="btn" disabled={busy} onClick={async () => { if (await run(() => api.addActivity(s.id, act), 'Activity added.')) { setAdding(false); setAct({ kind: 'Art', title: '', detail: '', date: '' }); } }}>Save activity</button>
        </div>
      </Modal>
    </>
  );
}
