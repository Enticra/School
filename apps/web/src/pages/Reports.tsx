import { useEffect, useState } from 'react';
import { formatDate } from '@enticra/core';
import { PrintModal, printDoc, saveDocument } from '../showcase/kit';
import { Crest, Icon, Loading, PageHead, Seg, useAction, useApp, useConfirm, useLoad, type Ctx } from '../ui';

type RC = Awaited<ReturnType<Ctx['api']['reportCard']>>;

export function ReportCard({ rc }: { rc: RC & { year?: string; result?: string } }) {
  const school = { name: rc.school.name, branding: rc.school.branding };
  return (
    <article className="report" aria-label={`Report card for ${rc.student.name}`}>
      <header className="lh">
        <Crest school={school} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--display)', fontWeight: 600, fontSize: '1.15rem', letterSpacing: '-.02em' }}>{rc.school.name}</div>
          <div style={{ fontSize: '.8rem', opacity: .8 }}>{rc.school.branding.letterhead || rc.school.board}{rc.school.branding.motto ? ` · “${rc.school.branding.motto}”` : ''}</div>
        </div>
      </header>
      <div className="body">
        <div className="row between"><h2 style={{ color: '#10232a' }}>Progress report · {rc.examName}{rc.year ? ` · ${rc.year}` : ''}</h2><span style={{ fontWeight: 700, fontSize: '1.4rem', fontFamily: 'var(--display)' }}>Grade {rc.grade}</span></div>
        <div className="facts">
          <div><b>Student</b>{rc.student.name}</div><div><b>Class</b>{rc.student.classLabel} · Roll {rc.student.rollNo}</div>
          <div><b>EMIS no.</b>{rc.student.emis}</div><div><b>Date of birth</b>{formatDate(rc.student.dob)}</div>
          <div><b>Parent</b>{rc.student.guardian}</div><div><b>Attendance</b>{rc.attendancePct}%</div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th>Subject</th><th style={{ textAlign: 'right' }}>Marks</th><th style={{ textAlign: 'right' }}>Out of</th><th style={{ textAlign: 'right' }}>%</th><th>Grade</th></tr></thead>
            <tbody>
              {rc.rows.map((r) => <tr key={r.subject}><td>{r.subject}</td><td style={{ textAlign: 'right' }} className="num">{r.marks ?? '–'}</td><td style={{ textAlign: 'right' }} className="num">{r.max || '–'}</td><td style={{ textAlign: 'right' }} className="num">{r.pct ?? '–'}</td><td style={{ color: r.pass === false ? '#B42318' : undefined, fontWeight: 650 }}>{r.grade}</td></tr>)}
              <tr style={{ fontWeight: 700 }}><td>Total</td><td style={{ textAlign: 'right' }} className="num">{rc.total}</td><td style={{ textAlign: 'right' }} className="num">{rc.max}</td><td style={{ textAlign: 'right' }} className="num">{rc.overall}</td><td>{rc.grade}</td></tr>
            </tbody>
          </table>
        </div>
        <div className="facts"><div><b>Class rank</b>{rc.rank} of {rc.classSize}</div><div><b>{rc.result ? 'Result' : 'Board'}</b>{rc.result ?? rc.school.board}</div></div>
        <div><b style={{ fontSize: '.7rem', textTransform: 'uppercase', letterSpacing: '.07em', color: '#4a6a70' }}>Remarks</b><p style={{ marginTop: 4 }}>{rc.remark}</p></div>
        {rc.activities.length > 0 && <div><b style={{ fontSize: '.7rem', textTransform: 'uppercase', letterSpacing: '.07em', color: '#4a6a70' }}>Beyond the classroom</b><p style={{ marginTop: 4 }}>{rc.activities.map((a) => `${a.title} (${a.detail})`).join(' · ')}</p></div>}
        <div className="sig"><span>Class advisor · {rc.classTeacher}</span><span>Principal · {rc.principal}</span><span>Parent</span></div>
      </div>
    </article>
  );
}

export function Reports() {
  const { api, toast, session } = useApp();
  const viewOnly = session.user.role === 'principal';
  const classes = useLoad(() => api.listClasses(), []);
  const [classId, setClassId] = useState('');
  const [examName, setExamName] = useState('');
  const [studentId, setStudentId] = useState('');
  const { run, busy } = useAction();
  const [confirm, confirmEl] = useConfirm();
  useEffect(() => { if (!classId && classes.data?.length) setClassId(classes.data[0].id); }, [classes.data, classId]);
  const names = useLoad(() => (classId ? api.examNames(classId) : Promise.resolve([])), [classId]);
  const students = useLoad(() => (classId ? api.listStudents({ classId }) : Promise.resolve([])), [classId]);
  useEffect(() => { if (names.data?.length && !names.data.includes(examName)) setExamName(names.data.at(-1)!); }, [names.data, examName]);
  useEffect(() => { if (students.data?.length && !students.data.some((s) => s.id === studentId)) setStudentId(students.data[0].id); }, [students.data, studentId]);
  const rc = useLoad(() => (studentId && examName && students.data?.some((s) => s.id === studentId) ? api.reportCard(studentId, examName) : Promise.resolve(null)), [studentId, examName]);

  if (!classes.data) return <Loading />;
  return (
    <>
      {confirmEl}
      <PageHead title="Report cards" lede={viewOnly ? 'Every student’s report card by class and exam. Class advisors send them to parents.' : 'Built in your school’s format and grading scale. Send every parent their child’s card on WhatsApp in one go.'}>
        {!viewOnly && <button className="btn" disabled={busy || !examName} onClick={async () => { if (await confirm({ title: 'Send report cards to parents?', body: <>Every parent in {classes.data?.find((c) => c.id === classId)?.label} gets the {examName} report card on WhatsApp ({students.data?.length ?? 0} students). Check a few cards before sending.</>, confirm: 'Send report cards' })) run(() => api.sendReportCards(classId, examName), (r) => `${r.messages.length} report cards sent to parents.`); }}><Icon name="send" size={18} />Send class to parents</button>}
        <button className="btn ghost" onClick={() => void saveDocument(document.querySelector('main .report'), 'Report card', toast)}>Download</button>
        <button className="btn ghost" onClick={() => printDoc(toast, '.report')}>Print or save as PDF</button>
      </PageHead>
      <div className="card row between">
        <div className="row">
          <Seg label="Class" value={classId} onChange={(v) => { setClassId(v); setStudentId(''); }} options={classes.data.map((c) => ({ value: c.id, label: c.label }))} />
          {names.data && names.data.length > 0 && <Seg label="Exam" value={examName} onChange={setExamName} options={names.data.map((n) => ({ value: n, label: n }))} />}
        </div>
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 260px) minmax(0, 1fr)', gap: 16, alignItems: 'start' }} data-collapse>
        <div className="card no-print" style={{ padding: 10 }}>
          <div className="nav" style={{ color: 'var(--tx)' }}>
            {students.data?.map((s) => (
              <button key={s.id} aria-current={s.id === studentId ? 'page' : undefined} onClick={() => setStudentId(s.id)} style={{ opacity: 1 }}>
                <span className="dim num" style={{ width: 20 }}>{s.rollNo}</span>{s.name}
              </button>
            ))}
          </div>
        </div>
        <div>{rc.data ? <ReportCard rc={rc.data} /> : names.data?.length === 0 ? <div className="empty">No published results for this class yet.</div> : <Loading />}</div>
      </div>
    </>
  );
}

/** Every report card a student has had at this school, by standard and academic year: for the student and their parents. */
export function ReportHistory({ studentId }: { studentId: string }) {
  const { api } = useApp();
  const list = useLoad(() => api.reportCardList(studentId), [studentId]);
  const [std, setStd] = useState<'all' | number>('all');
  const [key, setKey] = useState('');
  const [printing, setPrinting] = useState(false);
  const cards = list.data ?? [];
  const standards = [...new Map(cards.map((c) => [c.grade, c])).values()].sort((a, b) => b.grade - a.grade);
  const shown = std === 'all' ? cards : cards.filter((c) => c.grade === std);
  // Open the latest card of the newest standard in view until the reader picks one.
  const newest = shown.filter((c) => c.grade === shown[0]?.grade);
  const pick = shown.find((c) => c.key === key)?.key ?? newest.at(-1)?.key ?? '';
  const rc = useLoad(() => (pick ? api.reportCardByKey(studentId, pick) : Promise.resolve(null)), [studentId, pick]);
  if (!list.data) return <Loading />;
  if (!cards.length) return <div className="card empty">No report cards published yet.</div>;
  const cur = shown.find((c) => c.key === pick);
  const open = (k: string) => { setKey(k); requestAnimationFrame(() => document.getElementById('rh-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' })); };
  return (
    <div className="stack">
      <div className="card stack">
        <div className="row between" style={{ gap: 12, flexWrap: 'wrap' }}>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <label htmlFor="rh-g" className="small">Standard</label>
            <select id="rh-g" className="input" style={{ width: 'auto', maxWidth: '100%' }} value={String(std)} onChange={(e) => { setStd(e.target.value === 'all' ? 'all' : Number(e.target.value)); setKey(''); }}>
              <option value="all">All standards ({cards.length} report cards)</option>
              {standards.map((c) => <option key={c.grade} value={c.grade}>Standard {c.grade} · {c.year}{c.current ? ' (this year)' : ''}</option>)}
            </select>
          </div>
          <span className="dim small">{standards.length > 1 ? `${standards.length} years at the school, standards ${standards.at(-1)!.grade} to ${standards[0].grade}.` : 'Report cards from earlier years appear here after the student moves up a standard.'}</span>
        </div>
        <div className="table-wrap">
          <table className="table" aria-label="Report cards">
            <thead><tr><th>Standard</th><th>Exam</th><th className="r">Overall</th><th>Grade</th><th className="r rh-wide">Rank</th><th className="rh-wide">Result</th></tr></thead>
            <tbody>
              {shown.map((c) => {
                const on = c.key === pick;
                return (
                  <tr key={c.key} className="click" aria-current={on ? 'true' : undefined} tabIndex={0} style={on ? { boxShadow: 'inset 3px 0 0 var(--school-accent)', background: 'var(--bg-2)' } : undefined}
                    onClick={() => open(c.key)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(c.key); } }}>
                    <td style={{ whiteSpace: 'nowrap' }}><strong>{c.classLabel}</strong><div className="dim small">{c.year}{c.current ? ' · this year' : ''}</div></td>
                    <td style={{ whiteSpace: 'nowrap' }}>{c.examName}</td>
                    <td className="r">{c.overall === null ? '–' : `${c.overall}%`}</td>
                    <td>{c.letter || '–'}</td>
                    <td className="r rh-wide">{c.rank ? `${c.rank} of ${c.classSize}` : '–'}</td>
                    <td className="rh-wide">{c.result ? <span className="pill ok">{c.result}</span> : <span className="dim">{on ? 'Showing below' : 'View'}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div id="rh-card" className="row between" style={{ gap: 12, flexWrap: 'wrap', scrollMarginTop: 16 }}>
        <span className="dim small">{cur ? `Showing ${cur.examName}, standard ${cur.classLabel}, ${cur.year}.${cur.current ? '' : ' From the school’s records for that year.'}` : ''}</span>
        {rc.data && <button className="btn ghost" onClick={() => setPrinting(true)}><Icon name="download" size={18} />Download or print</button>}
      </div>
      {rc.data ? <ReportCard rc={rc.data} /> : <Loading />}
      {rc.data && <PrintModal title={`Report card · ${rc.data.examName} · ${rc.data.year}`} open={printing} onClose={() => setPrinting(false)}><ReportCard rc={rc.data} /></PrintModal>}
    </div>
  );
}
