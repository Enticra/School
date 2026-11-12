import { useEffect, useState } from 'react';
import { formatDate, isoDate, type AttendanceMark, type OutboundMessage } from '@enticra/core';
import { Icon, Loading, PageHead, Seg, useAction, useApp, useLoad } from '../ui';
import { WaBubble } from './Messages';

const NEXT: Record<AttendanceMark, AttendanceMark> = { P: 'A', A: 'L', L: 'P' };
const WORD: Record<AttendanceMark, string> = { P: 'Present', A: 'Absent', L: 'Late' };

export function Attendance() {
  const { api, session } = useApp();
  const school = session.school!;
  const classes = useLoad(() => api.listClasses(), []);
  const [classId, setClassId] = useState('');
  const [date, setDate] = useState(isoDate(new Date()));
  const [sessionKey, setSessionKey] = useState<'am' | 'pm'>('am');
  const [marks, setMarks] = useState<Record<string, AttendanceMark>>({});
  const [sent, setSent] = useState<OutboundMessage[] | null>(null);
  const { run, busy } = useAction();

  useEffect(() => {
    if (!classId && classes.data?.length) {
      const own = classes.data.find((c) => c.classTeacherId === session.user.id) ?? classes.data[0];
      setClassId(own.id);
    }
  }, [classes.data, classId, session.user.id]);

  const sessionMode = school.settings.attendanceMode === 'session';
  const reg = useLoad(() => (classId ? api.getAttendance(classId, date, sessionMode ? sessionKey : 'day') : Promise.resolve(null)), [classId, date, sessionKey]);
  useEffect(() => {
    if (!reg.data) return;
    setMarks(reg.data.record ? { ...reg.data.record.marks } : Object.fromEntries(reg.data.students.map((s) => [s.id, 'P' as AttendanceMark])));
  }, [reg.data]);
  useEffect(() => setSent(null), [classId, date, sessionKey]);

  if (!classes.data) return <Loading />;
  const counts = { P: 0, A: 0, L: 0 };
  for (const m of Object.values(marks)) counts[m]++;
  const saved = !!reg.data?.record;
  // The class advisor marks the register once; subject teachers see who is absent before their period.
  const own = (id: string) => classes.data!.find((c) => c.id === id)?.classTeacherId === session.user.id;
  const canMark = session.user.role !== 'teacher' || own(classId);
  const advised = classes.data.filter((c) => c.classTeacherId === session.user.id);
  const advisorName = classes.data.find((c) => c.id === classId)?.teacher;
  const isToday = date === isoDate(new Date());

  const submit = async () => {
    const r = await run(() => api.markAttendance({ classId, date, session: sessionMode ? sessionKey : 'day', marks }), (r) => r.messages.length ? `Saved. ${r.messages.filter((m) => m.status !== 'skipped_no_consent').length} parents notified on WhatsApp.` : 'Attendance saved.');
    if (r) setSent(r.messages);
  };

  return (
    <>
      <PageHead title="Attendance" lede={session.user.role === 'teacher' ? (advised.length ? `You mark the register for ${advised.map((c) => c.label).join(' and ')}, your class, each morning. For the other classes you teach, see who is absent or late before your period.` : 'Each class advisor marks their class register in the morning. Here you see who is absent or late in the classes you teach, before your period.') : `Tap a student to cycle Present, Absent, Late. Parents get ${school.settings.notify.arrived ? 'an arrived, absent or late' : 'an absent or late'} message as soon as you save${isToday ? '' : ' (only for today’s register)'}.`}>
        <span className="pill">{sessionMode ? 'Morning and afternoon' : 'Once a day'} · late after {school.settings.lateCutoff}</span>
      </PageHead>

      <div className="card">
        <div className="row between" style={{ gap: 14 }}>
          <div className="row">
            <Seg label="Class" value={classId} onChange={setClassId} options={classes.data.map((c) => ({ value: c.id, label: c.classTeacherId === session.user.id && session.user.role === 'teacher' ? `${c.label} (my class)` : c.label }))} />
            {sessionMode && <Seg label="Session" value={sessionKey} onChange={setSessionKey} options={[{ value: 'am', label: 'Morning' }, { value: 'pm', label: 'Afternoon' }]} />}
            <label className="sr" htmlFor="att-date">Date</label>
            <input id="att-date" type="date" className="input" style={{ width: 170 }} value={date} max={isoDate(new Date())} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="row">
            <span className="pill ok">{counts.P} present</span>
            <span className="pill bad">{counts.A} absent</span>
            <span className="pill warn">{counts.L} late</span>
          </div>
        </div>
      </div>

      {!reg.data ? <Loading /> : (
        <div className="split">
          <div className="card">
            <div className="card-head">
              <div>
                <h2>{reg.data.class.label} · {formatDate(date)}</h2>
                <p className="dim small" style={{ marginTop: 4 }}>{saved ? `Saved at ${new Date(reg.data.record!.markedAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}. Changes message only the parents affected.` : 'Not saved yet. Everyone starts as present.'}</p>
              </div>
              {canMark && <button className="btn sm ghost" onClick={() => setMarks(Object.fromEntries(reg.data!.students.map((s) => [s.id, 'P' as AttendanceMark])))}>Mark all present</button>}
            </div>
            <div className="register" role="list">
              {reg.data.students.map((s) => {
                const m = marks[s.id] ?? 'P';
                return (
                  canMark ? (
                  <button key={s.id} role="listitem" className="reg-cell" data-m={m} aria-label={`${s.name}: ${WORD[m]}. Tap to change.`} onClick={() => setMarks((x) => ({ ...x, [s.id]: NEXT[x[s.id] ?? 'P'] }))}>
                    <span className="roll">{s.rollNo}</span>
                    <span className="nm">{s.name}</span>
                    <span className="mk" aria-hidden="true">{m}</span>
                  </button>
                  ) : (
                  <div key={s.id} role="listitem" className="reg-cell" data-m={saved ? m : undefined} aria-label={`${s.name}: ${saved ? WORD[m] : 'not marked yet'}`} style={{ cursor: 'default' }}>
                    <span className="roll">{s.rollNo}</span>
                    <span className="nm">{s.name}</span>
                    <span className="mk" aria-hidden="true">{saved ? m : '–'}</span>
                  </div>
                  )
                );
              })}
            </div>
            {!canMark && <p className="dim small" style={{ marginTop: 14 }}>{saved ? `Marked by the class advisor, ${advisorName ?? 'the class advisor'}. Only they can change it.` : `${advisorName ?? 'The class advisor'} has not marked ${reg.data.class.label} yet.`} If a student is missing from your period, tell the class advisor; they update the register and the parent is told.</p>}
            {canMark && <div className="row" style={{ marginTop: 18, justifyContent: 'flex-end' }}>
              <button className="btn lg" onClick={submit} disabled={busy}><Icon name="send" size={18} />{saved ? 'Update and notify changes' : 'Save and notify parents'}</button>
            </div>}
          </div>
          <div className="card">
            <div className="card-head"><h2>What parents see</h2></div>
            {sent ? (
              sent.length ? (
                <div className="wa">
                  {sent.slice(0, 4).map((m) => <WaBubble key={m.id} m={m} />)}
                  {sent.length > 4 && <span className="dim small">and {sent.length - 4} more</span>}
                </div>
              ) : <div className="empty">No new messages. Nothing changed for any parent.</div>
            ) : (
              <div className="stack">
                <p className="muted small">After you save, each parent gets one message on WhatsApp in their language. Examples:</p>
                <div className="wa">
                  <div className="bubble">{reg.data.students[0]?.name.split(' ')[0]} reached school at 08:24 today. – {school.shortName}</div>
                  <div className="bubble" lang="ta">{reg.data.students[1]?.name.split(' ')[0]} இன்று பள்ளிக்கு வரவில்லை. விடுப்புக்கான காரணத்தை பதில் அனுப்பவும். – {school.shortName}</div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
