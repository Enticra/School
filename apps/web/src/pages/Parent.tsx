import { useEffect, useState } from 'react';
import { formatDate, isoDate } from '@enticra/core';
import { Crest, Loading, PageHead, Seg, useApp, useLoad } from '../ui';
import { StudentProfile } from './Students';
import { ReportHistory } from './Reports';
import { WaBubble } from './Messages';

export function ParentHome() {
  const { api, session } = useApp();
  const children = session.children;
  const [childId, setChildId] = useState(children[0]?.id ?? '');
  const [tab, setTab] = useState<'today' | 'progress' | 'report'>('today');
  const child = children.find((c) => c.id === childId);
  const profile = useLoad(() => (childId ? api.getStudent(childId) : Promise.resolve(null)), [childId]);
  const homework = useLoad(() => api.listHomework({ classId: child?.classId }), [childId]);
  const messages = useLoad(() => api.listMessages({ studentId: childId, limit: 5 }), [childId]);

  if (!child) return <div className="empty">No children are linked to this number yet. Ask the school office to add you.</div>;
  if (!profile.data) return <Loading />;
  const today = isoDate(new Date());
  const todayMark = profile.data.attendance.recent.find((d) => d.date === today)?.mark;
  const due = (homework.data ?? []).filter((h) => h.dueDate >= today);
  const latest = [...profile.data.results].reverse().find((r) => r.pct !== null);

  return (
    <>
      <PageHead title={`Hello, ${session.user.name.replace(/^(Mr|Mrs|Ms)\.\s*/, '')}`} lede={`Updates from ${session.school!.shortName}. You also get these on WhatsApp.`}>
        {children.length > 1 && <Seg label="Child" value={childId} onChange={setChildId} options={children.map((c) => ({ value: c.id, label: c.name.split(' ')[0] }))} />}
      </PageHead>
      <Seg label="Section" value={tab} onChange={setTab} options={[{ value: 'today', label: 'Today' }, { value: 'progress', label: 'Progress' }, { value: 'report', label: 'Report cards' }]} />

      {tab === 'today' && (
        <>
          <div className="grid cols-3">
            <div className="card stat">
              <span className="eyebrow">Today</span>
              <span className="value" style={{ fontSize: '1.6rem', color: todayMark === 'A' ? 'var(--bad)' : todayMark ? 'var(--ok)' : undefined }}>{todayMark === 'A' ? 'Absent' : todayMark === 'L' ? 'Late' : todayMark === 'P' ? 'In school' : 'Not marked yet'}</span>
              <span className="foot">{profile.data.classLabel} · attendance this term {profile.data.attendance.pct}%</span>
            </div>
            <div className="card stat">
              <span className="eyebrow">Homework due</span>
              <span className="value">{due.length}</span>
              <span className="foot">{due[0] ? `Next: ${due[0].subject}, due ${formatDate(due[0].dueDate)}` : 'Nothing pending'}</span>
            </div>
            <div className="card stat">
              <span className="eyebrow">Latest test</span>
              <span className="value">{latest ? <>{latest.total}<small>/ {latest.max}</small></> : '–'}</span>
              <span className="foot">{latest ? `${latest.subject} · ${latest.name}` : 'No results yet'}</span>
            </div>
          </div>
          <div className="split" style={{ alignItems: 'start' }}>
            <div className="card">
              <div className="card-head"><h2>Homework</h2></div>
              {due.length === 0 ? <div className="empty">No homework due.</div> : (
                <div className="list">{due.map((h) => <div key={h.id}><div className="row between"><b>{h.subject}: {h.title}</b><span className="pill">Due {formatDate(h.dueDate)}</span></div>{h.details && <p className="muted small" style={{ marginTop: 4 }}>{h.details}</p>}</div>)}</div>
              )}
            </div>
            <div className="wa">
              <div className="wa-head"><Crest school={session.school!} /><div><b>{session.school!.shortName}</b><div className="dim small">WhatsApp</div></div></div>
              {[...(messages.data ?? [])].reverse().map((m) => <WaBubble key={m.id} m={m} />)}
            </div>
          </div>
        </>
      )}
      {tab === 'progress' && <StudentProfile id={childId} embedded />}
      {tab === 'report' && (
        <ReportHistory key={childId} studentId={childId} />
      )}
    </>
  );
}

/** All of a child's report cards, from every standard they have studied at the school. */
export function ParentReports() {
  const { session } = useApp();
  const children = session.children;
  const [childId, setChildId] = useState(children[0]?.id ?? '');
  const child = children.find((c) => c.id === childId);
  if (!child) return <div className="empty">No children are linked to this number yet. Ask the school office to add you.</div>;
  return (
    <>
      <PageHead eyebrow="Report cards" title={`${child.name.split(' ')[0]}’s report cards`} lede="Every report card from every year at the school. Pick a standard to narrow the list, then open any card.">
        {children.length > 1 && <Seg label="Child" value={childId} onChange={setChildId} options={children.map((c) => ({ value: c.id, label: c.name.split(' ')[0] }))} />}
      </PageHead>
      <ReportHistory key={childId} studentId={childId} />
    </>
  );
}
