import { useEffect, useState } from 'react';
import { addDays, formatDate, isoDate } from '@enticra/core';
import { Icon, Loading, Modal, PageHead, readImage, relTime, useAction, useApp, useConfirm, useLoad } from '../ui';
import { SubmissionsModal } from '../showcase/School';

export function HomeworkPage() {
  const { api, session, toast } = useApp();
  const classes = useLoad(() => api.listClasses(), []);
  const list = useLoad(() => api.listHomework(), []);
  const [form, setForm] = useState({ classId: '', subject: '', title: '', details: '', dueDate: isoDate(addDays(new Date(), 1)), photoDataUrl: '' });
  const { run, busy } = useAction();
  const [viewing, setViewing] = useState<string | null>(null);
  const [edit, setEdit] = useState<null | { id: string; title: string; details: string; dueDate: string }>(null);
  const [ask, confirmEl] = useConfirm();

  useEffect(() => {
    if (!form.classId && classes.data?.length) {
      const c = classes.data[0];
      const subj = session.user.subjects?.find((s) => c.subjects.includes(s)) ?? c.subjects[0];
      setForm((f) => ({ ...f, classId: c.id, subject: subj }));
    }
  }, [classes.data, form.classId, session.user.subjects]);

  if (!classes.data || !list.data) return <Loading />;
  const cls = classes.data.find((c) => c.id === form.classId);
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await run(() => api.createHomework({ ...form, photoDataUrl: form.photoDataUrl || undefined }), (r) => `Posted to ${cls?.label}. ${r.messages.filter((m) => m.status !== 'skipped_no_consent').length} parents notified.`);
    if (r) setForm((f) => ({ ...f, title: '', details: '', photoDataUrl: '' }));
  };

  const remove = async (h: NonNullable<typeof list.data>[number]) => {
    if (!(await ask({ title: `Delete “${h.title}”?`, body: <>It is removed for {h.classLabel}.{h.handedIn > 0 && <> The {h.handedIn} hand-ins from students are deleted too.</>} Parents already got the WhatsApp message; they are not messaged again.</>, confirm: 'Delete homework', danger: true }))) return;
    await run(() => api.deleteHomework(h.id), (r) => `“${r.deleted}” deleted.`);
  };
  return (
    <>
      {confirmEl}
      <Modal open={!!edit} onClose={() => setEdit(null)} title="Edit homework">
        {edit && (
          <form className="stack" style={{ gap: 12 }} onSubmit={async (e) => { e.preventDefault(); if (await run(() => api.updateHomework(edit.id, { title: edit.title, details: edit.details, dueDate: edit.dueDate }), 'Homework updated. Students see the change; parents are not messaged again.')) setEdit(null); }}>
            <div className="field"><label htmlFor="he-t">What to do</label><input id="he-t" className="input" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></div>
            <div className="field"><label htmlFor="he-d">Notes for students</label><textarea id="he-d" className="input" value={edit.details} onChange={(e) => setEdit({ ...edit, details: e.target.value })} /></div>
            <div className="field"><label htmlFor="he-due">Due on</label><input id="he-due" type="date" className="input" min={isoDate(new Date())} value={edit.dueDate} onChange={(e) => setEdit({ ...edit, dueDate: e.target.value })} /></div>
            <div className="row"><button className="btn" disabled={busy || !edit.title.trim() || !edit.dueDate}>Save changes</button><button type="button" className="btn ghost" onClick={() => setEdit(null)}>Cancel</button></div>
          </form>
        )}
      </Modal>
      <PageHead title="Homework" lede="Enter it once. Parents see it on WhatsApp the same evening, students hand in a photo of their work, and the teacher who set it sees who handed in." />
      <SubmissionsModal homeworkId={viewing} onClose={() => { setViewing(null); list.reload(); }} />
      <div className="split" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="card-head"><h2>Recent homework</h2><span className="dim small">{list.data.length} posts</span></div>
          {list.data.length === 0 ? <div className="empty">No homework posted yet.</div> : (
            <div className="list">
              {list.data.map((h) => (
                <div key={h.id} className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap', gap: 14 }}>
                  <span className="pill" style={{ marginTop: 2 }}>{h.classLabel}</span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="row between"><b>{h.subject}: {h.title}</b><span className={`pill ${h.dueDate <= isoDate(new Date()) ? 'warn' : ''}`}>Due {formatDate(h.dueDate)}</span></div>
                    {h.details && <p className="muted small" style={{ marginTop: 4 }}>{h.details}</p>}
                    {h.photoDataUrl && <img src={h.photoDataUrl} alt="Photo of the board" style={{ marginTop: 8, maxHeight: 140, borderRadius: 10 }} />}
                    <div className="row between" style={{ marginTop: 4 }}>
                      <span className="dim small">{h.teacher} · {relTime(h.createdAt)}
                        {(session.user.role === 'principal' || h.assignedBy === session.user.id) && <> · <button className="btn sm quiet" onClick={() => setEdit({ id: h.id, title: h.title, details: h.details, dueDate: h.dueDate < isoDate(new Date()) ? isoDate(new Date()) : h.dueDate })}>Edit</button><button className="btn sm quiet" onClick={() => void remove(h)}>Delete</button></>}
                      </span>
                      {(session.user.role === 'principal' || h.assignedBy === session.user.id || classes.data!.find((c) => c.id === h.classId)?.classTeacherId === session.user.id)
                        ? <button className="btn sm ghost" onClick={() => setViewing(h.id)}>Handed in {h.handedIn} of {h.classSize}</button>
                        : <span className="dim small">{h.handedIn} of {h.classSize} handed in</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <form className="card stack" onSubmit={submit} style={{ gap: 14 }}>
          <h2>Post homework</h2>
          <div className="grid cols-2" style={{ gap: 12 }}>
            <div className="field"><label htmlFor="hw-class">Class</label>
              <select id="hw-class" className="input" value={form.classId} onChange={(e) => { const c = classes.data!.find((x) => x.id === e.target.value)!; setForm((f) => ({ ...f, classId: c.id, subject: c.subjects.includes(f.subject) ? f.subject : c.subjects[0] })); }}>
                {classes.data.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select></div>
            <div className="field"><label htmlFor="hw-subject">Subject</label>
              <select id="hw-subject" className="input" value={form.subject} onChange={(e) => set('subject', e.target.value)}>
                {cls?.subjects.map((s) => <option key={s}>{s}</option>)}
              </select></div>
          </div>
          <div className="field"><label htmlFor="hw-title">What to do</label><input id="hw-title" className="input" placeholder="Exercise 7.3, sums 1 to 5" value={form.title} onChange={(e) => set('title', e.target.value)} /></div>
          <div className="field"><label htmlFor="hw-details">Notes for students (optional)</label><textarea id="hw-details" className="input" placeholder="Show every step and write units." value={form.details} onChange={(e) => set('details', e.target.value)} /></div>
          <div className="field"><label htmlFor="hw-due">Due on</label><input id="hw-due" type="date" className="input" min={isoDate(new Date())} value={form.dueDate} onChange={(e) => set('dueDate', e.target.value)} /></div>
          <div className="field">
            <span className="label">Photo of the board (optional)</span>
            <label className="drop" style={{ cursor: 'pointer' }}>
              <input type="file" accept="image/*" capture="environment" className="sr" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { try { set('photoDataUrl', await readImage(f, 1200)); } catch (err) { toast((err as Error).message, 'err'); } } }} />
              {form.photoDataUrl ? <img src={form.photoDataUrl} alt="Selected photo" style={{ maxHeight: 120, borderRadius: 8 }} /> : <span className="row" style={{ justifyContent: 'center' }}><Icon name="camera" />Take or choose a photo</span>}
            </label>
          </div>
          <div className="wa">
            <span className="eyebrow">WhatsApp preview</span>
            <div className="bubble">Today's {form.subject} homework for Arun: {form.title || '…'}. Due {form.dueDate}. – {session.school!.shortName}</div>
          </div>
          <button className="btn lg" disabled={busy || !form.title.trim()}><Icon name="send" size={18} />Post and notify parents</button>
        </form>
      </div>
    </>
  );
}
