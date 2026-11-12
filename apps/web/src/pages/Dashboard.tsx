import { formatDate, isoDate } from '@enticra/core';
import { Bar, Icon, Loading, PageHead, relTime, useApp, useLoad } from '../ui';
import { WaBubble } from './Messages';

export function Dashboard() {
  const { api, session, go } = useApp();
  const { data } = useLoad(() => api.dashboard(), []);
  const principal = session.user.role === 'principal';
  const teachers = useLoad(() => (principal ? api.teacherOverview() : Promise.resolve(null)), []);
  const staff = useLoad(() => (principal ? api.getStaffAttendance(isoDate(new Date())) : Promise.resolve(null)), []);
  const myClasses = useLoad(() => (principal ? Promise.resolve([]) : api.listClasses()), []);
  if (!data) return <Loading />;
  const { kpis } = data;
  const isTeacher = session.user.role === 'teacher';
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  // Teachers only mark the register of the class they advise.
  const advised = new Set((myClasses.data ?? []).filter((c) => c.classTeacherId === session.user.id).map((c) => c.id));
  const unmarked = data.byClass.filter((c) => !c.markedToday && (principal || advised.has(c.id)));

  return (
    <>
      <PageHead eyebrow={formatDate(data.today)} title={`${hello}, ${session.user.name.replace(/^(Mr|Mrs|Ms)\.\s*/, '').split(' ').slice(-1)[0]}`}
        lede={isTeacher ? 'Your classes today, what needs marking and who needs attention.' : 'How the school is doing today, and where to act.'}>
        {unmarked.length > 0 && <button className="btn" onClick={() => go({ page: 'attendance' })}><Icon name="check" size={18} />{principal ? `${unmarked.length} classes not marked yet` : `Mark ${unmarked.map((c) => c.label).join(', ')} attendance`}</button>}
      </PageHead>

      <div className="grid cols-4">
        <div className="card stat">
          <span className="eyebrow">Present today</span>
          <span className="value">{kpis.attendancePct ?? '–'}<small>{kpis.attendancePct === null ? '' : '%'}</small></span>
          <span className="foot">{kpis.classesMarked} of {kpis.classes} classes marked · {kpis.absent} absent, {kpis.late} late</span>
        </div>
        <div className="card stat">
          <span className="eyebrow">Parents messaged</span>
          <span className="value">{kpis.messagesToday}</span>
          <span className="foot">WhatsApp updates sent today</span>
        </div>
{principal ? (
          <button className="card stat" style={{ textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit' }} onClick={() => go({ page: 'staffatt' })}>
            <span className="eyebrow">Staff today</span>
            {staff.data?.record ? <><span className="value">{staff.data.staff.filter((x) => x.mark === 'P' || x.mark === 'OD').length}<small>/ {staff.data.staff.length}</small></span><span className="foot">{staff.data.staff.filter((x) => x.mark === 'A').length} absent · {staff.data.staff.filter((x) => x.mark === 'L').length} on leave</span></>
              : <><span className="value" style={{ fontSize: '1.4rem' }}>Not marked</span><span className="foot">{staff.data?.staff.filter((x) => x.mark === 'L' || x.mark === 'OD').length ?? 0} on approved leave or duty · mark the staff register</span></>}
          </button>
        ) : (
                <button className="card stat" style={{ textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit' }} onClick={() => go({ page: 'correction' })}>
            <span className="eyebrow">Scripts to review</span>
            <span className="value">{kpis.scriptsToReview}<small>/ {kpis.scriptsToReview + kpis.scriptsWaiting + kpis.scriptsApproved}</small></span>
            <span className="foot">{kpis.scriptsWaiting} waiting for AI correction · {kpis.scriptsApproved} approved</span>
          </button>
        )}
        <div className="card stat">
          <span className="eyebrow">Students needing attention</span>
          <span className="value" style={{ color: data.atRisk.length ? 'var(--bad)' : undefined }}>{data.atRisk.length}</span>
          <span className="foot">Low attendance or marks near the pass mark</span>
        </div>
      </div>

      <div className="split">
        <div className="card">
          <div className="card-head"><h2>Classes</h2><span className="dim small">Attendance this term · average marks in published tests</span></div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Class</th><th>Today</th><th style={{ width: '32%' }}>Attendance</th><th style={{ width: '32%' }}>Average marks</th></tr></thead>
              <tbody>
                {data.byClass.map((c) => (
                  <tr key={c.id} className="click" onClick={() => go({ page: c.markedToday ? 'students' : 'attendance' })}>
                    <td><b>{c.label}</b><div className="dim small">{c.students} students</div></td>
                    <td>{c.markedToday ? <span className={`pill ${c.absentToday ? 'warn' : 'ok'}`}>{c.absentToday ? `${c.absentToday} absent` : 'All present'}</span> : <span className="pill accent"><span className="dot" />Not marked</span>}</td>
                    <td><Bar value={c.attendancePct} label="" thresholds={[75, 90]} /></td>
                    <td><Bar value={c.averagePct} label="" thresholds={[45, 60]} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h2>Needs attention</h2></div>
          {data.atRisk.length === 0 ? <div className="empty">No one is at risk right now.</div> : (
            <div className="list">
              {data.atRisk.slice(0, 7).map((s) => (
                <button key={s.id} onClick={() => go({ page: 'students', id: s.id })} style={{ all: 'unset', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 4, padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
                  <span className="row between"><b>{s.name}</b><span className="dim small">{s.classLabel}</span></span>
                  <span className="chip-list">{s.reasons.map((r) => <span key={r} className="pill bad">{r}</span>)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {principal && teachers.data && (
        <div className="card">
          <div className="card-head"><h2>Teachers</h2><button className="btn sm ghost" onClick={() => go({ page: 'teachers' })}>All teachers</button></div>
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Teacher</th><th>Teaches</th><th>Class advisor</th><th style={{ width: '24%' }}>Average in their classes</th><th>Pass rate</th></tr></thead>
            <tbody>{teachers.data.map((t) => (
              <tr key={t.id} className="click" onClick={() => go({ page: 'teachers' })}>
                <td><b>{t.name}</b><div className="dim small">{t.subjects.join(', ')}</div></td>
                <td className="small">{t.pairs.map((p) => p.classLabel).join(', ')}</td>
                <td>{t.classTeacherOf.length ? t.classTeacherOf.map((c) => <span key={c.classId} className={`pill ${c.attendanceMarkedToday ? 'ok' : 'accent'}`} style={{ marginRight: 4 }}>{c.classLabel}{c.attendanceMarkedToday ? ' ✓' : ' · not marked'}</span>) : <span className="dim">–</span>}</td>
                <td>{t.avgPct === null ? '–' : <Bar value={t.avgPct} label="" thresholds={[45, 60]} />}</td>
                <td className="num">{t.passPct === null ? '–' : `${t.passPct}%`}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </div>
      )}

      <div className="grid cols-2">
        <div className="card">
          <div className="card-head"><h2>Weakest chapters</h2><span className="dim small">Share of marks scored, all published tests</span></div>
          <div className="stack" style={{ gap: 14 }}>
            {data.weakChapters.map((w) => <Bar key={w.subject + w.chapter} value={w.pct} label={w.chapter} sub={w.subject} />)}
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h2>Latest parent messages</h2><button className="btn sm ghost" onClick={() => go({ page: 'messages' })}>All messages</button></div>
          <div className="wa">
            {data.recentMessages.map((m) => <WaBubble key={m.id} m={m} meta={relTime(m.createdAt)} />)}
          </div>
        </div>
      </div>
    </>
  );
}
