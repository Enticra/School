import { useEffect, useRef, useState } from 'react';
import { formatDate, isoDate } from '@enticra/core';
import { Bar, Crest, Icon, Modal, PageHead, Seg, Switch, useApp, useConfirm, useLoad } from '../ui';
import { Stats, Table, Tabs, day, dayLabel, inr, useDemo, useRoster } from './kit';

// ---------------------------------------------------------------- WhatsApp bot

type Line = { me: boolean; text: string; at: string };
const SUGGEST = ['Today’s homework?', 'Last test marks?', 'Fee due?', 'Is he in school?', 'Bus location?', 'இன்றைய வீட்டுப்பாடம்?'];

export function BotChat({ compact }: { compact?: boolean }) {
  const { api, session } = useApp();
  const roster = useRoster();
  const child = session.children[0] ?? roster[0];
  const kid = useLoad(() => (child ? api.getStudent(child.id) : Promise.resolve(null)), [child?.id]);
  const hw = useLoad(() => (child ? api.listHomework({ classId: child.classId }) : Promise.resolve([])), [child?.id]);
  const first = child?.name.split(' ')[0] ?? 'Arun';
  const now = () => new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  const [lines, setLines] = useState<Line[]>([{ me: false, text: `Vanakkam! I’m the ${session.school?.shortName} assistant. Ask about homework, marks, attendance, fees or the bus, in English or Tamil.`, at: now() }]);
  const [text, setText] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight, behavior: 'smooth' }); }, [lines]);

  const answer = (q: string): string => {
    const s = q.toLowerCase();
    const today = isoDate(new Date());
    if (s.includes('homework') || s.includes('வீட்டு')) {
      const due = (hw.data ?? []).filter((h) => h.dueDate >= today);
      const ta = /[஀-௿]/.test(q);
      if (!due.length) return ta ? `${first}க்கு இன்று வீட்டுப்பாடம் இல்லை.` : `${first} has no homework due.`;
      return (ta ? `${first}இன் வீட்டுப்பாடம்:\n` : `${first}’s homework:\n`) + due.slice(0, 3).map((h) => `• ${h.subject}: ${h.title} (due ${formatDate(h.dueDate, ta ? 'ta' : 'en')})`).join('\n');
    }
    if (s.includes('mark') || s.includes('test') || s.includes('result')) {
      const r = [...(kid.data?.results ?? [])].reverse().find((x) => x.pct !== null);
      return r ? `${first} scored ${r.total}/${r.max} (${r.pct}%) in ${r.subject}, ${r.name}. Weakest chapter so far: ${kid.data?.chapters[0]?.chapter ?? '–'}. Reply “feedback” for answer-wise comments.` : 'No published marks yet.';
    }
    if (s.includes('feedback')) return `Maths, Q4: lost 2 marks for not writing the formula before substituting. Tip: always write the formula line; examiners give a step mark for it.`;
    if (s.includes('fee') || s.includes('due') || s.includes('pay')) return `Term 2 fee: ${inr(18500)} due on ${dayLabel(12)}. Pay by UPI: upi://pay?pa=school@upi (sample link). Reply “receipt” for your last receipt.`;
    if (s.includes('school') || s.includes('present') || s.includes('absent') || s.includes('attend')) {
      const m = kid.data?.attendance.recent.find((d) => d.date === today)?.mark;
      return m ? `${first} is marked ${m === 'P' ? 'present' : m === 'L' ? 'late' : 'absent'} today. Attendance this term: ${kid.data?.attendance.pct}%.` : `Today’s attendance isn’t marked yet. You’ll get a message as soon as it is.`;
    }
    if (s.includes('bus')) return 'Bus TN 38 AB 1234 (Route 4) is 2 stops away from Saibaba Colony, about 6 minutes. Driver: Mr. Selvam.';
    if (s.includes('leave')) return `Leave request for ${first} sent to the class advisor. You’ll get a reply here.`;
    if (s.includes('receipt')) return `Receipt R-2026-0417: ${inr(18500)}, Term 1, paid by UPI. PDF attached (sample).`;
    return 'I can help with homework, marks, attendance, fees, the bus and leave. For anything else, the class advisor will reply during school hours.';
  };
  const ask = (q: string) => {
    if (!q.trim()) return;
    const at = now();
    setLines((l) => [...l, { me: true, text: q, at }]);
    setText('');
    window.setTimeout(() => setLines((l) => [...l, { me: false, text: answer(q), at }]), 550);
  };

  return (
    <div className="wa" style={{ maxWidth: compact ? undefined : 560 }}>
      <div className="wa-head">{session.school && <Crest school={session.school} />}<div><b>{session.school?.shortName}</b><div className="dim small">WhatsApp · automated replies</div></div></div>
      <div className="chat" ref={box} aria-live="polite">{lines.map((l, i) => <div key={i} className={`bubble ${l.me ? 'me' : ''}`} style={{ whiteSpace: 'pre-wrap' }}>{l.text}<div className="meta"><span>{l.at}</span>{l.me && <span style={{ color: '#34B7F1' }}>✓✓</span>}</div></div>)}</div>
      <div className="chip-list">{SUGGEST.map((s) => <button key={s} className="pill" style={{ cursor: 'pointer', border: 0 }} onClick={() => ask(s)}>{s}</button>)}</div>
      <form className="row" style={{ flexWrap: 'nowrap' }} onSubmit={(e) => { e.preventDefault(); ask(text); }}><input aria-label="Message" className="input" placeholder="Type a message" value={text} onChange={(e) => setText(e.target.value)} /><button className="btn" aria-label="Send"><Icon name="send" size={18} /></button></form>
    </div>
  );
}

export function Bot() {
  return (
    <>
      <PageHead eyebrow="WhatsApp bot" title="Parents ask, the bot answers" lede="Parents message the school’s WhatsApp number and get instant answers from live school data. Try it below as the parent of the first student on the roll." />
      <div className="split" style={{ alignItems: 'start' }}>
        <BotChat />
        <div className="stack" style={{ gap: 16 }}>
          <Stats items={[{ label: 'Questions answered this week', value: 1842 }, { label: 'Handed to a teacher', value: '4%' }]} />
          <div className="card stack"><h3>Top questions</h3>{[['Today’s homework', 41], ['Last test marks', 22], ['Fee due', 14], ['Bus location', 12], ['Leave', 7]].map(([q, p]) => <Bar key={q} value={p as number} label={q} thresholds={[0, 0]} />)}</div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- PTM, surveys, daily digest

const PTM_SLOTS = ['4:00', '4:10', '4:20', '4:30', '4:40', '4:50', '5:00', '5:10', '5:20', '5:30', '5:40', '5:50'];
const SURVEY = [{ q: 'How satisfied are you with WhatsApp updates?', yes: 91 }, { q: 'Is the amount of homework right?', yes: 68 }, { q: 'Do you understand the answer-wise feedback?', yes: 84 }, { q: 'Would you recommend the school to a friend?', yes: 88 }];

/** The PTM date the school chose; shared by the staff and parent views. */
export const usePtmDate = () => useDemo('ptm-date', day(4));

export function PtmBooking() {
  const { api, toast, session } = useApp();
  const classes = useLoad(() => api.listClasses(), []);
  const [all, setAll] = useDemo<Record<string, Record<string, string>>>('ptm-v2', { cls_s1_10a: { '4:00': 'Abinaya S', '4:10': 'Bharath R', '4:30': 'Deepika M', '5:00': 'Harini K', '5:20': 'Janani T' } });
  const parent = session.user.role === 'parent';
  const [kidId, setKidId] = useState(session.children[0]?.id ?? '');
  const kid = session.children.find((k) => k.id === kidId) ?? session.children[0];
  const [pickCls, setPickCls] = useState('cls_s1_10a');
  const classId = parent ? kid?.classId ?? '' : classes.data?.some((c) => c.id === pickCls) ? pickCls : classes.data?.[0]?.id ?? '';
  const cls = classes.data?.find((c) => c.id === classId);
  const booked = all[classId] ?? {};
  const setBooked = (n: Record<string, string>) => setAll({ ...all, [classId]: n });
  const mine = Object.entries(booked).find(([, n]) => n === kid?.name)?.[0];
  const [date, setDate] = usePtmDate();
  const [ask, confirmEl] = useConfirm();
  const when = formatDate(date);
  return (
    <div className="card stack">
      {confirmEl}
      <div className="card-head" style={{ margin: 0 }}><h2>Parent–teacher meeting · {when}</h2><span className="dim small">{cls ? `${cls.label} · ${cls.teacher}` : ''} · 10-minute slots</span></div>
      {parent ? session.children.length > 1 && <Seg label="Child" value={kid.id} onChange={setKidId} options={session.children.map((k) => ({ value: k.id, label: k.name }))} />
        : <span className="row" style={{ gap: 8 }}><label htmlFor="ptm-cls" className="small">Class</label><select id="ptm-cls" className="input" style={{ width: 'auto' }} value={classId} onChange={(e) => setPickCls(e.target.value)}>{(classes.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.label} · {c.teacher}</option>)}</select><span className="dim small">{Object.keys(booked).length} of {PTM_SLOTS.length} slots booked</span></span>}
      {!parent && (
        <div className="row" style={{ gap: 10 }}>
          <label htmlFor="ptm-date" className="small">PTM date</label>
          <input id="ptm-date" type="date" className="input" style={{ width: 170 }} min={day(0)} value={date} onChange={async (e) => {
            const v = e.target.value;
            if (!v || v === date) return;
            if (Object.keys(booked).length && !(await ask({ title: 'Move the PTM?', body: `${Object.values(all).reduce((t, x) => t + Object.keys(x).length, 0)} parents have booked slots. They keep the same times and get a WhatsApp message with the new date, ${formatDate(v)}.`, confirm: 'Move and tell parents' }))) return;
            setDate(v);
            toast(`PTM moved to ${formatDate(v)}. Booked parents were told.`);
          }} />
          <span className="dim small">Parents see this date when they book.</span>
        </div>
      )}
      <div className="grid cols-4" style={{ gap: 8 }}>
        {PTM_SLOTS.map((t) => {
          const who = booked[t];
          const isMine = parent && who === kid?.name;
          return (
            <button key={t} className="opt" aria-pressed={isMine} disabled={parent && !!who && !isMine} style={parent && who && !isMine ? { opacity: .45, cursor: 'not-allowed' } : undefined} onClick={async () => {
              if (!parent) return toast(who ? `${who}’s parent booked ${t} pm.` : `${t} pm is free.`);
              const n = { ...booked };
              if (mine) delete n[mine];
              if (!isMine) n[t] = kid.name;
              if (isMine && !(await ask({ title: 'Cancel your slot?', body: `Your ${t} pm slot on ${when} will be freed for another parent.`, confirm: 'Cancel slot', danger: true }))) return;
              setBooked(n);
              toast(isMine ? 'Slot cancelled. You can book another time.' : mine ? `Moved to ${t} pm on ${when}.` : `Booked ${t} pm on ${when}. Reminder on WhatsApp the day before.`);
            }}>
              <b className="num">{t}</b><span className="small dim" style={{ marginLeft: 'auto' }}>{isMine ? 'Your slot' : who ? (parent ? 'Taken' : who) : 'Free'}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function Meetings() {
  const { toast } = useApp();
  const [tab, setTab] = useState<'ptm' | 'surveys' | 'digest'>('ptm');
  const [surveys, setSurveys] = useDemo<{ id: string; title: string; qs: string[]; status: 'Sent' | 'Draft' | 'Closed'; replies: number }[]>('surveys', []);
  const [sopen, setSopen] = useState(false);
  const [sid, setSid] = useState<string | null>(null);
  const [sf, setSf] = useState({ title: 'Annual day feedback', qs: 'Did your child enjoy the annual day?\nWas the event timing convenient?\nWould you volunteer next year?' });
  const [digest, setDigest] = useDemo('digest', { on: true, time: '19:00', instant: ['arrived', 'absent'] as string[] });
  const [ptmDate] = usePtmDate();
  const [ask, confirmEl] = useConfirm();
  const sendSurvey = async (v: { id: string; title: string; qs: string[] }) => {
    if (!(await ask({ title: `Send “${v.title}”?`, body: <>It goes to 1,180 parents on WhatsApp with Yes, No and Not sure buttons. Once sent it can be closed but not unsent.<ol className="small" style={{ marginTop: 8 }}>{v.qs.map((q) => <li key={q}>{q}</li>)}</ol></>, confirm: 'Send to 1,180 parents' }))) return;
    setSurveys(surveys.map((x) => (x.id === v.id ? { ...x, status: 'Sent', replies: 37 } : x)));
    toast(`${v.title} sent to 1,180 parents as WhatsApp buttons. Replies are coming in.`);
  };
  const removeSurvey = async (v: { id: string; title: string; status: string }) => {
    if (!(await ask({ title: v.status === 'Draft' ? 'Delete this draft?' : 'Close this survey?', body: v.status === 'Draft' ? `“${v.title}” has not been sent. It will be removed.` : `Parents can no longer answer “${v.title}”. Replies so far are kept.`, confirm: v.status === 'Draft' ? 'Delete draft' : 'Close survey', danger: true }))) return;
    setSurveys(v.status === 'Draft' ? surveys.filter((x) => x.id !== v.id) : surveys.map((x) => (x.id === v.id ? { ...x, status: 'Closed' } : x)));
    toast(v.status === 'Draft' ? 'Draft deleted.' : 'Survey closed.');
  };
  return (
    <>
      {confirmEl}
      <PageHead eyebrow="Parents" title="Meetings, surveys and the daily digest" lede="Parents book PTM slots from WhatsApp, answer short surveys, and can choose one evening digest instead of many messages." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'ptm', label: 'PTM booking' }, { value: 'surveys', label: 'Surveys' }, { value: 'digest', label: 'Daily digest' }]} />
      {tab === 'ptm' && <><Stats items={[{ label: 'Slots booked', value: '5 of 12' }, { label: 'Reminders sent', value: 5 }, { label: 'Last PTM turnout', value: '86%' }]} /><PtmBooking /></>}
      {tab === 'surveys' && (
        <div className="split" style={{ alignItems: 'start' }}>
          <div className="card stack" style={{ gap: 14 }}><div className="card-head" style={{ margin: 0 }}><h2>Term 1 parent feedback</h2><span className="pill ok">412 replies · 74%</span></div>{SURVEY.map((s) => <Bar key={s.q} value={s.yes} label={s.q} sub="yes" thresholds={[50, 70]} />)}</div>
          <div className="card stack"><h3>What parents wrote</h3>{['“The Tamil messages are very useful for my mother-in-law.”', '“Please send homework before 5 pm.”', '“Answer-wise feedback helped my daughter in Maths.”'].map((q) => <p key={q} className="muted">{q}</p>)}<button className="btn ghost" onClick={() => { setSid(null); setSf({ title: 'Annual day feedback', qs: 'Did your child enjoy the annual day?\nWas the event timing convenient?\nWould you volunteer next year?' }); setSopen(true); }}><Icon name="plus" size={18} />New survey</button></div>
          {surveys.length > 0 && <div className="card" style={{ gridColumn: '1 / -1' }}><div className="card-head"><h2>Your surveys</h2></div><Table head={['Survey', 'Questions', 'Status', 'Replies', '']} rows={surveys.map((v) => [<b key="t">{v.title}</b>, <span key="q" className="small">{v.qs.join(' · ')}</span>, <span key="s" className={`pill ${v.status === 'Sent' ? 'ok' : ''}`}>{v.status}</span>, <span key="r" className="num">{v.replies}</span>, <div key="b" className="row" style={{ gap: 6 }}>{v.status === 'Draft' && <><button className="btn sm" onClick={() => void sendSurvey(v)}>Send to parents</button><button className="btn sm ghost" onClick={() => { setSid(v.id); setSf({ title: v.title, qs: v.qs.join('\n') }); setSopen(true); }}>Edit</button></>}{v.status !== 'Closed' ? <button className="btn sm ghost" onClick={() => void removeSurvey(v)}>{v.status === 'Draft' ? 'Delete' : 'Close'}</button> : <span className="dim small">Closed</span>}</div>])} /></div>}
        </div>
      )}
      <Modal open={sopen} onClose={() => setSopen(false)} title={sid ? 'Edit draft survey' : 'New survey'}>
        <form className="stack" style={{ gap: 12 }} onSubmit={(e) => { e.preventDefault(); const qs = sf.qs.split('\n').map((q) => q.trim()).filter(Boolean); if (!sf.title.trim() || !qs.length) return; if (sid) { setSurveys(surveys.map((x) => (x.id === sid ? { ...x, title: sf.title.trim(), qs } : x))); setSopen(false); toast('Draft updated.'); return; } setSurveys([{ id: `sv${Date.now()}`, title: sf.title.trim(), qs, status: 'Draft', replies: 0 }, ...surveys]); setSopen(false); toast('Survey saved as a draft. Send it from Your surveys.'); }}>
          <div className="field"><label htmlFor="sv-t">Title</label><input id="sv-t" className="input" value={sf.title} onChange={(e) => setSf({ ...sf, title: e.target.value })} /></div>
          <div className="field"><label htmlFor="sv-q">Questions, one per line (parents answer Yes, No or Not sure)</label><textarea id="sv-q" className="input" rows={4} value={sf.qs} onChange={(e) => setSf({ ...sf, qs: e.target.value })} /></div>
          <button className="btn">Save survey</button>
        </form>
      </Modal>
      {tab === 'digest' && (
        <div className="grid cols-2">
          <div className="card stack" style={{ gap: 14 }}>
            <div className="row between"><div><b>Offer a daily digest</b><div className="dim small">Parents can choose one message an evening</div></div><Switch checked={digest.on} label="Daily digest" onChange={(v) => setDigest({ ...digest, on: v })} /></div>
            <div className="field"><label htmlFor="dg-t">Send at</label><input id="dg-t" type="time" className="input" style={{ width: 140 }} value={digest.time} onChange={(e) => setDigest({ ...digest, time: e.target.value })} /></div>
            <div className="field"><span className="label">Always send instantly</span><div className="chip-list">{['arrived', 'absent', 'late', 'fee', 'emergency'].map((k) => <button key={k} className={`pill ${digest.instant.includes(k) ? 'ok' : ''}`} style={{ border: 0, cursor: 'pointer' }} onClick={() => setDigest({ ...digest, instant: digest.instant.includes(k) ? digest.instant.filter((x) => x !== k) : [...digest.instant, k] })}>{digest.instant.includes(k) ? '✓ ' : ''}{k}</button>)}</div></div>
            <span className="dim small">612 of 1,180 parents chose the digest.</span>
          </div>
          <div className="wa"><div className="bubble" style={{ whiteSpace: 'pre-wrap' }}>{`Arun’s day, ${dayLabel(0)}\n\n✓ Reached school 8:24 am\n📘 Homework: Maths Ex 7.2 (1–6), Science: draw the eye diagram\n📝 Trigonometry quick check: 12/15\n📅 PTM on ${formatDate(ptmDate)}: book a slot, reply PTM`}<div className="meta"><span>{digest.time}</span><span style={{ color: '#34B7F1' }}>✓✓</span></div></div></div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- gallery and emergency broadcast

export const ALBUMS = [
  { name: 'Annual sports day', n: 86, c: ['#1F8A5B', '#0B333B'] }, { name: 'Science exhibition', n: 42, c: ['#1B3A6B', '#2F7D86'] }, { name: 'Pongal celebration', n: 64, c: ['#D9822B', '#B4461A'] },
  { name: 'Independence Day', n: 38, c: ['#E26527', '#1F8A5B'] }, { name: 'Inter-school chess', n: 21, c: ['#45636A', '#072A30'] }, { name: 'Art club exhibition', n: 33, c: ['#9A6200', '#7A1E2C'] },
];
export function Gallery() {
  return <div className="gallery">{ALBUMS.map((a) => <div key={a.name} style={{ background: `linear-gradient(135deg, ${a.c[0]}, ${a.c[1]})` }}><span>{a.name}<br /><small style={{ fontWeight: 500 }}>{a.n} photos</small></span></div>)}</div>;
}

export function Broadcast() {
  const { toast } = useApp();
  const [tab, setTab] = useState<'broadcast' | 'gallery'>('broadcast');
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState('Due to heavy rain, school will close at 12:30 pm today. Buses leave at 12:45 pm. Please arrange pickup.');
  const [sent, setSent] = useDemo<{ text: string; at: string; reach: number }[]>('broadcasts', [{ text: 'School is closed tomorrow due to the cyclone warning. Online classes at 10 am.', at: dayLabel(-21), reach: 1176 }]);
  const [aud, setAud] = useState('all');
  const [ask, confirmEl] = useConfirm();
  const reach = aud === 'all' ? 1178 : 214;
  const send = async () => {
    if (!msg.trim()) return toast('Write the message first.', 'err');
    setOpen(false);
    if (!(await ask({ title: `Send to ${reach} parents now?`, body: <>This ignores quiet hours and can’t be recalled. Parents will read:<div className="wa" style={{ marginTop: 10 }}><div className="bubble" style={{ whiteSpace: 'pre-wrap' }}>{msg.trim()}</div></div></>, confirm: `Send to ${reach} parents`, danger: true }))) { setOpen(true); return; }
    setSent([{ text: msg.trim(), at: dayLabel(0), reach }, ...sent]);
    toast(`Sent to ${reach} parents in English and Tamil. Delivery tracked.`);
  };
  return (
    <>
      {confirmEl}
      <PageHead eyebrow="Parents" title="Emergency broadcast and photo gallery" lede="Reach every parent in a minute, in their language, ignoring quiet hours. Share event photos without flooding class groups.">
        <button className="btn" style={{ background: 'var(--bad)', color: '#fff' }} onClick={() => setOpen(true)}><Icon name="megaphone" size={18} />Emergency broadcast</button>
      </PageHead>
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'broadcast', label: 'Broadcasts' }, { value: 'gallery', label: 'Photo gallery' }]} />
      {tab === 'broadcast' && <div className="card"><Table head={['Message', 'Sent', 'Reached']} rows={sent.map((s) => [s.text, s.at, <span key="r" className="pill ok">{s.reach} parents</span>])} /></div>}
      {tab === 'gallery' && <><p className="muted">Albums are shared with parents of the classes in them. Parents can download, never re-share the link.</p><Gallery /></>}
      <Modal open={open} onClose={() => setOpen(false)} title="Emergency broadcast">
        <form className="stack" style={{ gap: 12 }} onSubmit={(e) => { e.preventDefault(); void send(); }}>
          <div className="field"><span className="label">To</span><Seg label="Audience" value={aud} onChange={setAud} options={[{ value: 'all', label: 'All parents' }, { value: 'bus', label: 'Bus parents only' }]} /></div>
          <div className="field"><label htmlFor="bc">Message</label><textarea id="bc" className="input" required value={msg} onChange={(e) => setMsg(e.target.value)} /></div>
          <p className="dim small">Goes out immediately on WhatsApp and SMS, with a Tamil translation for Tamil-first parents.</p>
          <button className="btn" style={{ background: 'var(--bad)', color: '#fff' }}>Review and send</button>
        </form>
      </Modal>
    </>
  );
}
