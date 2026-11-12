import { useEffect, useRef, useState } from 'react';
import { formatDate, scriptTotal, type AnswerScript, type Exam } from '@enticra/core';
import { backend, DEMO } from '../api';
import { Confidence, Icon, Loading, Modal, PageHead, readPage, rotateImage, useAction, useApp, useLoad, type Ctx, type PagePick } from '../ui';

type ExamData = Awaited<ReturnType<Ctx['api']['getExam']>>;

export function Correction({ examId }: { examId?: string }) {
  const { api, go } = useApp();
  const exams = useLoad(() => api.listExams(), []);
  if (examId) return <ExamCorrection id={examId} />;
  if (!exams.data) return <Loading />;
  const marking = exams.data.filter((e) => e.status === 'marking' || e.scripts.total > 0);
  return (
    <>
      <PageHead title="AI correction" lede="Scan the answer papers with a phone. The AI marks each answer against your marking scheme with step marks, a reason and a confidence score. You check and approve; you always have the final say." />
      <div className="grid cols-3">
        {[['1', 'Scan', 'Photograph each script, or use the scanner. One student per script.'], ['2', 'AI marks', 'Every answer gets step marks, a reason and a confidence score.'], ['3', 'You approve', 'Low-confidence answers are flagged. Change any mark, then approve.']].map(([n, t, d]) => (
          <div key={n} className="card row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap', gap: 14 }}>
            <span className="crest" style={{ width: 34, height: 34, fontSize: '.9rem', borderRadius: 10 }}>{n}</span>
            <div><h3>{t}</h3><p className="muted small" style={{ marginTop: 4 }}>{d}</p></div>
          </div>
        ))}
      </div>
      <div className="card">
        <div className="card-head"><h2>Tests open for correction</h2></div>
        {marking.length === 0 ? <div className="empty">No tests are being marked. Create a test first, then upload scripts here.</div> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Test</th><th>Class</th><th className="r">Scripts</th><th className="r">Waiting</th><th className="r">To review</th><th className="r">Approved</th><th /></tr></thead>
            <tbody>{marking.map((e) => (
              <tr key={e.id} className="click" onClick={() => go({ page: 'correction', id: e.id })}>
                <td><b>{e.subject} · {e.name}</b><div className="dim small">{formatDate(e.date)} · {e.max} marks</div></td>
                <td>{e.classLabel}</td>
                <td className="r num">{e.scripts.total}</td><td className="r num">{e.scripts.waiting}</td>
                <td className="r num">{e.scripts.toReview ? <span className="pill accent">{e.scripts.toReview}</span> : 0}</td>
                <td className="r num">{e.scripts.approved}</td>
                <td className="r"><Icon name="arrow" size={18} /></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </>
  );
}

function ExamCorrection({ id }: { id: string }) {
  const { api, go, toast, bump } = useApp();
  const { data, reload } = useLoad(() => api.getExam(id), [id]);
  const agreement = useLoad(() => api.gradingAgreement(id), [id]);
  const config = useLoad(() => backend.config(), []);
  const [grading, setGrading] = useState<{ done: number; total: number } | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [uploadFor, setUploadFor] = useState<string | null>(null);
  const poll = useRef<number>();
  useEffect(() => () => window.clearInterval(poll.current), []);
  if (!data) return <Loading />;
  const { exam } = data;
  const byStudent = new Map(data.scripts.map((s) => [s.studentId, s]));
  const waiting = data.scripts.filter((s) => s.status === 'uploaded' || s.status === 'failed');
  const toReview = data.scripts.filter((s) => s.status === 'graded');
  const approved = data.scripts.filter((s) => s.status === 'approved');

  const runAi = async () => {
    const ids = waiting.map((s) => s.id);
    setGrading({ done: 0, total: ids.length });
    api.gradeScripts(exam.id).catch((e: Error) => toast(e.message, 'err'));
    const started = Date.now();
    poll.current = window.setInterval(async () => {
      const d = await api.getExam(exam.id);
      const left = d.scripts.filter((s) => ids.includes(s.id) && (s.status === 'uploaded' || s.status === 'grading')).length;
      setGrading({ done: ids.length - left, total: ids.length });
      if (left === 0 || Date.now() - started > 5 * 60_000) {
        window.clearInterval(poll.current);
        setGrading(null);
        const failed = d.scripts.filter((s) => ids.includes(s.id) && s.status === 'failed').length;
        toast(failed ? `${ids.length - failed} scripts corrected, ${failed} failed. Try those again.` : `${ids.length} scripts corrected. Review the flagged answers, then approve.`, failed ? 'err' : 'ok');
        bump();
      }
    }, 700);
  };

  const order = data.students.map((s) => byStudent.get(s.id)).filter((s): s is AnswerScript => !!s && (s.status === 'graded' || s.status === 'approved'));
  const reviewIndex = order.findIndex((s) => s.id === reviewId);

  return (
    <>
      <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => go({ page: 'correction' })}><Icon name="back" size={16} />All tests</button>
      <PageHead eyebrow={`${data.classLabel} · ${formatDate(exam.date)} · ${exam.questions.length} questions, ${data.max} marks`} title={`${exam.subject} · ${exam.name}`}
        lede={`Marking against the ${exam.questions.reduce((t, q) => t + q.steps.length, 0)}-step scheme. AI marks are suggestions until you approve them.`}>
        <button className="btn ghost" onClick={() => go({ page: 'tests', id: exam.id })}>Marks sheet</button>
        <button className="btn" disabled={!waiting.length || !!grading} onClick={runAi}><Icon name="spark" size={18} />{waiting.length ? `Correct ${waiting.length} scripts with AI` : 'All scripts corrected'}</button>
      </PageHead>

      {!DEMO && config.data?.grader === 'mock' && (
        <div className="note-warn" role="status"><Icon name="alert" size={18} /><div><b>Photos are not being read yet.</b> The server has no Claude API key, so it can only mark the typed sample scripts. Add <code>ANTHROPIC_API_KEY</code> to the server's <code>.env</code> file and restart it to read handwriting from any photo.</div></div>
      )}

      {grading && (
        <div className="card stack" aria-live="polite">
          <div className="row between"><b>Correcting scripts…</b><span className="num muted">{grading.done} of {grading.total}</span></div>
          <div className="progress"><i style={{ width: `${grading.total ? (grading.done / grading.total) * 100 : 0}%` }} /></div>
          <span className="dim small">Reading handwriting, splitting answers, applying step marks.{DEMO ? ' Demo mode uses a keyword grader on sample scripts; the live server uses Claude vision.' : ''}</span>
        </div>
      )}

      <div className="grid cols-4">
        <div className="card stat"><span className="eyebrow">Scripts in</span><span className="value">{data.scripts.length}<small>/ {data.students.length}</small></span><span className="foot">{data.students.length - data.scripts.length} not uploaded</span></div>
        <div className="card stat"><span className="eyebrow">Waiting for AI</span><span className="value">{waiting.length}</span></div>
        <div className="card stat"><span className="eyebrow">Ready for review</span><span className="value" style={{ color: toReview.length ? 'var(--or-text)' : undefined }}>{toReview.length}</span><span className="foot">{toReview.reduce((t, s) => t + s.responses.filter((r) => r.needsReview).length, 0)} answers flagged</span></div>
        <div className="card stat"><span className="eyebrow">AI matched you</span><span className="value">{agreement.data?.answers ? agreement.data.answersWithinHalf : '–'}<small>{agreement.data?.answers ? '%' : ''}</small></span><span className="foot">{agreement.data?.scripts ? `of answers within ½ mark, ${agreement.data.scripts} approved scripts` : 'Shows after you approve scripts'}</span></div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Students</h2>{toReview.length > 0 && <button className="btn sm" onClick={() => setReviewId(toReview[0].id)}>Start review</button>}</div>
        <div className="table-wrap"><table className="table">
          <thead><tr><th>#</th><th>Student</th><th>Status</th><th className="r">AI marks</th><th className="r">Final</th><th>Flags</th><th /></tr></thead>
          <tbody>{data.students.map((st) => {
            const s = byStudent.get(st.id);
            const flags = s?.responses.filter((r) => r.needsReview).length ?? 0;
            return (
              <tr key={st.id}>
                <td className="dim num">{st.rollNo}</td>
                <td>{st.name}</td>
                <td>{!s ? <span className="pill">Not uploaded</span> : <StatusPill s={s} />}</td>
                <td className="r num">{s && s.responses.length ? `${s.responses.reduce((t, r) => t + r.aiMarks, 0)}` : '–'}</td>
                <td className="r num"><b>{s?.status === 'approved' ? scriptTotal(s.responses) : '–'}</b></td>
                <td>{s?.pageIssues?.length ? <span className="pill bad" title={s.pageIssues.map((p) => `Page ${p.page}: ${p.issue}`).join('\n')}>Re-take page {s.pageIssues.map((p) => p.page).join(', ')}</span> : null} {flags ? <span className="pill warn">{flags} to check</span> : s?.responses.length ? <span className="pill ok">None</span> : null}</td>
                <td className="r" style={{ whiteSpace: 'nowrap' }}><span className="row" style={{ gap: 6, justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                  {s && (s.status === 'graded' || s.status === 'approved') && <button className="btn sm quiet" onClick={() => setReviewId(s.id)}>{s.status === 'approved' ? 'View' : 'Review'}</button>}
                  {(!s || s.status === 'uploaded' || s.status === 'failed' || (s.status === 'graded' && !!s.pageIssues?.length)) && <button className="btn sm ghost" onClick={() => setUploadFor(st.id)}><Icon name="camera" size={16} />{s ? 'Re-scan' : 'Scan'}</button>}
                </span></td>
              </tr>
            );
          })}</tbody>
        </table></div>
        {approved.length > 0 && approved.length === data.scripts.length && exam.status !== 'published' && (
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
            <button className="btn" onClick={() => go({ page: 'tests', id: exam.id })}>All approved. Publish marks</button>
          </div>
        )}
      </div>

      <Upload open={!!uploadFor} exam={exam} student={data.students.find((s) => s.id === uploadFor)} onClose={() => setUploadFor(null)} onDone={() => { setUploadFor(null); reload(); }} />
      {reviewId && reviewIndex >= 0 && (
        <Review key={reviewId} data={data} script={order[reviewIndex]} onClose={() => setReviewId(null)}
          onNext={() => { const next = order.slice(reviewIndex + 1).find((s) => s.status === 'graded') ?? order.find((s) => s.status === 'graded' && s.id !== reviewId); setReviewId(next?.id ?? null); }} />
      )}
    </>
  );
}

function StatusPill({ s }: { s: AnswerScript }) {
  if (s.status === 'approved') return <span className="pill ok">Approved</span>;
  if (s.status === 'graded') return <span className="pill accent"><span className="dot" />Ready for review</span>;
  if (s.status === 'grading') return <span className="pill warn">Correcting…</span>;
  if (s.status === 'failed') return <span className="pill bad" title={s.error}>Failed: {s.error}</span>;
  return <span className="pill">Scanned, waiting</span>;
}

function Upload({ open, exam, student, onClose, onDone }: { open: boolean; exam: Exam; student?: { id: string; name: string }; onClose: () => void; onDone: () => void }) {
  const { api, toast } = useApp();
  const { run, busy } = useAction();
  const [pages, setPages] = useState<PagePick[]>([]);
  const [reading, setReading] = useState(false);
  const [over, setOver] = useState(false);
  useEffect(() => { if (open) setPages([]); }, [open]);
  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    let picked = [...files];
    if (DEMO && picked.some((f) => /pdf|hei[cf]/i.test(f.type) || /\.(pdf|hei[cf])$/i.test(f.name))) {
      toast('The demo can only take JPG or PNG photos. The live server also takes PDFs and iPhone photos.', 'err');
      picked = picked.filter((f) => !(/pdf|hei[cf]/i.test(f.type) || /\.(pdf|hei[cf])$/i.test(f.name)));
    }
    setReading(true);
    try { const read = await Promise.all(picked.slice(0, 12).map((f) => readPage(f))); setPages((p) => [...p, ...read].slice(0, 12)); }
    catch (e) { toast((e as Error).message, 'err'); }
    finally { setReading(false); }
  };
  const rotate = async (i: number) => {
    try { const turned = await rotateImage(pages[i].dataUrl); setPages((p) => p.map((x, j) => (j === i ? { ...x, dataUrl: turned, preview: turned } : x))); }
    catch (e) { toast((e as Error).message, 'err'); }
  };
  const move = (i: number, d: -1 | 1) => setPages((p) => { const n = [...p]; const j = i + d; if (j < 0 || j >= n.length) return p; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const hasPdf = pages.some((p) => p.kind === 'pdf');
  const count = hasPdf ? 'files' : 'pages';
  return (
    <Modal open={open} onClose={onClose} title={`Scan script · ${student?.name ?? ''}`}>
      <div className="stack" style={{ gap: 14 }}>
        <label className={`drop ${over ? 'over' : ''}`} style={{ cursor: 'pointer' }} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); void add(e.dataTransfer.files); }}>
          <input type="file" accept="image/*,.heic,.heif,application/pdf,.pdf" multiple className="sr" onChange={(e) => { void add(e.target.files); e.target.value = ''; }} />
          <div className="stack" style={{ alignItems: 'center' }}><Icon name="camera" size={28} /><b>{reading ? 'Reading pages…' : 'Take photos of each page'}</b><span className="small">or drop photos or a PDF here. Up to 12 pages, in order. Any phone photo works, including iPhone photos and tilted or dim pages.</span></div>
        </label>
        {pages.length > 0 && (
          <div className="page-tiles">
            {pages.map((p, i) => (
              <div key={i} className="page-tile">
                <div className="img">{p.preview ? <img src={p.preview} alt={`Page ${i + 1}`} /> : <span><Icon name="file" size={22} /><br />{p.kind === 'pdf' ? 'PDF, split into pages on upload' : 'iPhone photo, converted on upload'}</span>}</div>
                <div className="tools">
                  <span className="num">{i + 1}</span>
                  <span>
                    {p.preview && <button type="button" title="Turn a quarter turn" aria-label={`Turn page ${i + 1}`} onClick={() => void rotate(i)}><Icon name="refresh" size={14} /></button>}
                    {i > 0 && <button type="button" title="Move earlier" aria-label={`Move page ${i + 1} earlier`} onClick={() => move(i, -1)}><Icon name="back" size={14} /></button>}
                    <button type="button" title="Remove" aria-label={`Remove page ${i + 1}`} onClick={() => setPages((x) => x.filter((_, j) => j !== i))}><Icon name="x" size={14} /></button>
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="qr-box small muted"><Icon name="file" />In the full rollout, each script carries a printed QR cover sheet so the scan finds the student by itself.</div>
        {DEMO && <p className="hint">Demo mode cannot read handwriting from photos, so uploaded pages are marked for you to grade by hand. The sample scripts already uploaded show the full AI flow.</p>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={!pages.length || busy || reading || !student} onClick={async () => { const r = await run(() => api.uploadScript({ examId: exam.id, studentId: student!.id, pages: pages.map((p) => ({ dataUrl: p.dataUrl })) }), (s) => `${s.pages.length} pages uploaded for ${student!.name}.`); if (r) onDone(); }}><Icon name="upload" size={18} />{busy ? 'Uploading…' : `Upload ${pages.length || ''} ${count}`}</button>
        </div>
      </div>
    </Modal>
  );
}

function Review({ data, script, onClose, onNext }: { data: ExamData; script: AnswerScript; onClose: () => void; onNext: () => void }) {
  const { api } = useApp();
  const { run, busy } = useAction();
  const { exam } = data;
  const student = data.students.find((s) => s.id === script.studentId)!;
  const [over, setOver] = useState<Record<string, string>>(() => Object.fromEntries(script.responses.map((r) => [r.no, r.teacherMarks !== undefined ? String(r.teacherMarks) : ''])));
  const [active, setActive] = useState(script.responses.find((r) => r.needsReview)?.no ?? '1');
  const approved = script.status === 'approved';
  const final = (no: string) => { const r = script.responses.find((x) => x.no === no)!; return over[no] !== '' && over[no] !== undefined ? Number(over[no]) : r.aiMarks; };
  const total = Math.round(script.responses.reduce((t, r) => t + final(r.no), 0) * 10) / 10;
  const transcript: Record<string, string> = Object.assign({}, ...script.pages.map((p) => p.transcript ?? {}));
  const images = script.pages.filter((p) => p.dataUrl);

  const approve = async () => {
    const overrides = Object.fromEntries(script.responses.map((r) => [r.no, over[r.no] === '' ? null : Number(over[r.no])]));
    const r = await run(() => api.reviewScript(script.id, { overrides, approve: true }), (r) => `${student.name}: ${r.total}/${r.max} approved.`);
    if (r) onNext();
  };

  return (
    <Modal open onClose={onClose} title={`${student.name} · ${exam.subject} ${exam.name}`} wide>
      <div className="grid" data-collapse style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.1fr)', gap: 20 }}>
        <div className="stack">
          <span className="eyebrow">Answer script{images.length ? ` · ${images.length} pages` : ' · sample scan'}</span>
          <div className="script">
            <div className="script-head"><span>Name: {student.name}</span><span>Roll {student.rollNo}</span><span>{exam.name}</span></div>
            {images.map((p, i) => <img key={i} src={p.dataUrl} alt={`Page ${i + 1}`} />)}
            {exam.questions.map((q) => {
              const r = script.responses.find((x) => x.no === q.no);
              const text = transcript[q.no] ?? r?.transcription;
              if (images.length && !text) return null;
              return (
                <div key={q.no} className={`q ${active === q.no ? 'active' : ''}`} onClick={() => setActive(q.no)}>
                  <span className="qno">{q.no}.</span>
                  {text ? text : <span className="blank">{text === '' ? '(left blank)' : '(could not read this answer)'}</span>}
                  {r && <span className="red">{final(q.no)}/{q.maxMarks}</span>}
                </div>
              );
            })}
          </div>
        </div>
        <div className="stack" style={{ gap: 12 }}>
          {!!script.pageIssues?.length && !approved && (
            <div className="note-warn" role="status"><Icon name="alert" size={18} /><div><b>Some pages were hard to read.</b> {script.pageIssues.map((p) => `Page ${p.page}: ${p.issue}.`).join(' ')} Check those answers on the paper, or close this and re-take the photo.</div></div>
          )}
          <div className="row between"><span className="eyebrow">AI marks · {script.grader === 'claude' ? 'Claude vision' : 'keyword grader'}</span><span className="pill">{script.responses.filter((r) => r.needsReview).length} flagged</span></div>
          {script.responses.map((r) => {
            const q = exam.questions.find((x) => x.no === r.no)!;
            return (
              <div key={r.no} className={`qcard ${r.needsReview ? 'flag' : ''} ${active === r.no ? 'on' : ''}`} onClick={() => setActive(r.no)}>
                <div className="row between" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0 }}><b>Q{r.no}</b> <span className="muted small">{q.chapter}</span><p className="small" style={{ marginTop: 2 }}>{q.text}</p></div>
                  <div className="stack" style={{ alignItems: 'flex-end', gap: 4, flex: 'none' }}>
                    <span style={{ fontFamily: 'var(--display)', fontSize: '1.3rem', letterSpacing: '-.03em' }} className="num">{r.aiMarks}<span className="dim" style={{ fontSize: '.85rem' }}>/{r.maxMarks}</span></span>
                    <Confidence value={r.confidence} />
                  </div>
                </div>
                <div className="steps">{r.steps.map((s, i) => <div key={i}><span className={s.found ? 'y' : 'n'}>{s.found ? '✓' : '✗'}</span><span>{s.text}</span><span className="num dim">{s.awarded}/{s.max}</span></div>)}</div>
                {r.needsReview && <p className="small" style={{ color: 'var(--warn)' }}><b>Check this:</b> {r.confidence === 0 ? r.reason : 'the AI is not sure. Look at the script before approving.'}</p>}
                {r.feedback && <p className="small muted">Feedback for the student: {r.feedback}</p>}
                {!approved && (
                  <div className="row">
                    <label className="small muted" htmlFor={`ov-${r.no}`}>Your mark</label>
                    <input id={`ov-${r.no}`} className="mark-input" inputMode="decimal" placeholder={String(r.aiMarks)} value={over[r.no] ?? ''} onChange={(e) => setOver((o) => ({ ...o, [r.no]: e.target.value }))} />
                    {over[r.no] !== '' && <button className="btn sm ghost" onClick={() => setOver((o) => ({ ...o, [r.no]: '' }))}>Use AI mark</button>}
                  </div>
                )}
                {approved && r.teacherMarks !== undefined && <span className="pill accent">Changed by teacher to {r.teacherMarks}</span>}
              </div>
            );
          })}
          <div className="card row between" style={{ position: 'sticky', bottom: -24, background: 'var(--sf)', boxShadow: 'var(--shadow)' }}>
            <div><span className="eyebrow">Total</span><div style={{ fontFamily: 'var(--display)', fontSize: '1.6rem', letterSpacing: '-.04em' }} className="num">{total}<span className="dim" style={{ fontSize: '1rem' }}>/{data.max}</span></div></div>
            {approved ? <button className="btn" onClick={onNext}>Next script</button> : <button className="btn lg" disabled={busy} onClick={approve}><Icon name="check" size={18} />Approve and next</button>}
          </div>
        </div>
      </div>
    </Modal>
  );
}
