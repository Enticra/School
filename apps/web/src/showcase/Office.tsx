import { useEffect, useMemo, useState } from 'react';
import { formatDate } from '@enticra/core';
import { Bar, Icon, Loading, Modal, PageHead, Seg, Switch, initials, relTime, useApp, useConfirm, useLoad } from '../ui';
import { ExportModal, Letterhead, PrintModal, QR, Stats, Table, Tabs, day, dayLabel, inr, pick, useDemo, useRoster } from './kit';

// ---------------------------------------------------------------- fees

type Head = { head: string; amount: number; when: string; optional?: boolean };
const STANDARDS = ['LKG–UKG', '1–5', '6–8', '9', '10', '11–12'];
const base = (tuition: number, books: number, lab: number): Head[] => [{ head: 'Tuition', amount: tuition, when: '3 instalments: June, Oct, Jan' }, { head: 'Term and exam fee', amount: 6000, when: 'June' }, { head: 'Lab and computer', amount: lab, when: 'June' }, { head: 'Books and uniform', amount: books, when: 'June' }, { head: 'Transport', amount: 14400, when: 'Monthly, ₹1,200', optional: true }];
const STRUCTURE: Record<string, Head[]> = { 'LKG–UKG': base(28000, 5200, 0), '1–5': base(32000, 6100, 2000), '6–8': base(36000, 6800, 3500), 9: base(40000, 7400, 4500), 10: base(42000, 7800, 4500), '11–12': base(48000, 8600, 6500) };
const standardOf = (classLabel: string) => { const g = Number(classLabel.split('-')[0]); return g >= 11 ? '11–12' : g >= 9 ? String(g) : g >= 6 ? '6–8' : g >= 1 ? '1–5' : 'LKG–UKG'; };

type Payment = { id: string; no: string; amount: number; mode: string; ref: string; date: string };

export function Fees() {
  const { toast } = useApp();
  const roster = useRoster();
  const [tab, setTab] = useState<'dues' | 'collection' | 'structure'>('dues');
  const [payments, setPayments] = useDemo<Payment[]>('fee-payments', []);
  const [std, setStd] = useState('all');
  const [sec, setSec] = useState('all');
  const grades = [...new Set(roster.map((s) => s.classLabel.split('-')[0]))].sort((a, b) => Number(b) - Number(a));
  const sections = [...new Set(roster.filter((s) => std === 'all' || s.classLabel.startsWith(`${std}-`)).map((s) => s.classLabel.split('-')[1]))].sort();
  const inFilter = (classLabel: string) => (std === 'all' || classLabel.startsWith(`${std}-`)) && (sec === 'all' || classLabel.endsWith(`-${sec}`));
  const allDues = useMemo(() => roster.filter((_, i) => i % 3 === 1).map((s, i) => ({ ...s, due: pick([18500, 14000, 18500, 6200, 1200], i), days: pick([3, 12, 26, 41, 7], i) })), [roster]);
  const dues = allDues.filter((d) => inFilter(d.classLabel));
  const [structure, setStructure] = useDemo<Record<string, Head[]>>('fee-structure', STRUCTURE);
  const [history, setHistory] = useDemo<{ at: string; standard: string; change: string }[]>('fee-structure-log', []);
  const [fsStd, setFsStd] = useState('10');
  const [draft, setDraft] = useState<Head[] | null>(null);
  const heads = draft ?? structure[fsStd] ?? [];
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(structure[fsStd]);
  const editHead = (i: number, patch: Partial<Head>) => setDraft(heads.map((h, j) => (j === i ? { ...h, ...patch } : h)));
  const saveStructure = async () => {
    if (heads.some((h) => !h.head.trim() || !(h.amount >= 0))) return toast('Every head needs a name and an amount.', 'err');
    const before = structure[fsStd] ?? [];
    const changes = [...heads.map((h) => { const b = before.find((x) => x.head === h.head); return !b ? `added ${h.head} ${inr(h.amount)}` : b.amount !== h.amount ? `${h.head} ${inr(b.amount)} → ${inr(h.amount)}` : b.when !== h.when || !!b.optional !== !!h.optional ? `${h.head} terms changed` : ''; }), ...before.filter((b) => !heads.some((h) => h.head === b.head)).map((b) => `removed ${b.head}`)].filter(Boolean);
    if (!(await ask({ title: `Save the fee structure for ${fsStd === 'all' ? '' : 'class '}${fsStd}?`, body: <>Changes: {changes.join('; ')}.<p style={{ marginTop: 8 }}>New fee books and reminders use these amounts from today. Receipts already issued don’t change, and parents are not messaged until you send reminders.</p></>, confirm: 'Save fee structure' }))) return;
    setStructure({ ...structure, [fsStd]: heads.map((h) => ({ ...h, head: h.head.trim(), amount: Math.round(h.amount) })) });
    setHistory([{ at: new Date().toISOString(), standard: fsStd, change: changes.join('; ') }, ...history]);
    setDraft(null);
    toast(`Fee structure for ${fsStd} saved.`);
  };
  const balance = (d: typeof dues[number]) => d.due - payments.filter((p) => p.id === d.id).reduce((t, p) => t + p.amount, 0);
  const open = dues.filter((d) => balance(d) > 0);
  const openAll = allDues.filter((d) => balance(d) > 0);
  const [ask, confirmEl] = useConfirm();
  const [paying, setPaying] = useState<typeof dues[number] | null>(null);
  const [pf, setPf] = useState({ amount: '', mode: 'Cash', ref: '', date: day(0) });
  const startPay = (d: typeof dues[number]) => { setPaying(d); setPf({ amount: String(balance(d)), mode: 'Cash', ref: '', date: day(0) }); };
  const record = () => {
    if (!paying) return;
    const amount = Math.round(Number(pf.amount));
    if (!amount || amount <= 0 || amount > balance(paying)) return toast(`Enter an amount between ₹1 and ${inr(balance(paying))}.`, 'err');
    if (pf.mode !== 'Cash' && !pf.ref.trim()) return toast(`Enter the ${pf.mode === 'Cheque' ? 'cheque number' : 'UPI reference'}.`, 'err');
    const no = `R-2026-${String(418 + payments.length).padStart(4, '0')}`;
    setPayments([...payments, { id: paying.id, no, amount, mode: pf.mode, ref: pf.ref.trim(), date: pf.date }]);
    setPaying(null);
    toast(`${inr(amount)} recorded for ${paying.name}. Receipt ${no} sent on WhatsApp.`);
  };
  const undoPay = async (p: Payment) => {
    const d = allDues.find((x) => x.id === p.id);
    if (!(await ask({ title: `Cancel receipt ${p.no}?`, body: `${inr(p.amount)} from ${d?.name ?? 'this family'} goes back to due. The parent is told the receipt was cancelled, and the cancellation is kept in the audit log.`, confirm: 'Cancel receipt', danger: true }))) return;
    setPayments(payments.filter((x) => x.no !== p.no));
    toast(`Receipt ${p.no} cancelled.`);
  };
  const sendReminders = async () => {
    const to = open.filter((d) => !linked.includes(d.id));
    const scope = std === 'all' ? 'all classes' : sec === 'all' ? `class ${std}` : `${std}-${sec}`;
    if (!(await ask({ title: `Send fee reminders to ${to.length} families in ${scope}?`, body: <>Each parent gets one WhatsApp message with their own amount and a UPI link, {inr(to.reduce((t, d) => t + balance(d), 0))} in all. Families already sent a link today are skipped.<ul className="small" style={{ marginTop: 8 }}>{to.slice(0, 5).map((d) => <li key={d.id}>{d.guardian.name} · {d.name} · {inr(balance(d))}</li>)}{to.length > 5 && <li>and {to.length - 5} more</li>}</ul></>, confirm: `Send to ${to.length} families` }))) return;
    setLinked([...new Set([...linked, ...to.map((d) => d.id)])]);
    toast(`UPI payment links sent to ${to.length} parents with dues.`);
  };
  const [linked, setLinked] = useDemo<string[]>('fees-linked', []);
  const [tally, setTally] = useState(false);
  const [exports, setExports] = useDemo<string[]>('tally-exports', []);
  const vouchers = payments.map((p) => { const d = allDues.find((x) => x.id === p.id); return [p.no, formatDate(p.date), d?.name ?? '', d?.classLabel ?? '', 'Fee receipt', p.mode, p.amount] as (string | number)[]; }).concat(roster.slice(0, 12).map((s, i) => [`R-2026-${String(400 + i).padStart(4, '0')}`, dayLabel(-3 - i), s.name, s.classLabel, 'Fee receipt', i % 3 ? 'UPI' : 'Cash', pick([18500, 14000, 1200], i)]));
  const paidTotal = payments.reduce((t, p) => t + p.amount, 0);
  return (
    <>
      {confirmEl}
      <PageHead eyebrow="Fees and finance" title="Fees" lede="Fee heads, instalments and concessions per school. Parents pay by UPI from a WhatsApp link, receipts go back automatically, and the office exports to Tally.">
        <button className="btn ghost" onClick={() => { setTally(true); setExports([dayLabel(0), ...exports]); }}><Icon name="download" size={18} />Export to Tally</button>
        <button className="btn" disabled={open.every((d) => linked.includes(d.id))} onClick={() => void sendReminders()}><Icon name="send" size={18} />{open.length && open.every((d) => linked.includes(d.id)) ? 'Reminders sent' : 'Send reminders'}</button>
      </PageHead>
      <Stats items={[{ label: 'Collected this term', value: inr(8412000 + paidTotal), foot: '82% of billed' }, { label: 'Outstanding', value: inr(1846000 - paidTotal), tone: 'bad', foot: `${openAll.length} families overdue` }, { label: 'Paid by UPI', value: '71%', foot: 'Up from 12% with cash and cheque' }, { label: 'Concessions', value: inr(388000), foot: 'Sibling, staff ward, RTE' }]} />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'dues', label: 'Dues' }, { value: 'collection', label: 'Collection' }, { value: 'structure', label: 'Fee structure' }]} />
      {tab !== 'structure' && (
        <div className="row" style={{ gap: 10 }}>
          <label htmlFor="fe-std" className="small">Standard</label>
          <select id="fe-std" className="input" style={{ width: 'auto' }} value={std} onChange={(e) => { setStd(e.target.value); setSec('all'); }}><option value="all">All standards</option>{grades.map((g) => <option key={g} value={g}>Class {g}</option>)}</select>
          <label htmlFor="fe-sec" className="small">Section</label>
          <select id="fe-sec" className="input" style={{ width: 'auto' }} value={sec} onChange={(e) => setSec(e.target.value)}><option value="all">All sections</option>{sections.map((x) => <option key={x} value={x}>{x}</option>)}</select>
          <span className="dim small">{open.length} families with dues · {inr(open.reduce((t, d) => t + balance(d), 0))}</span>
        </div>
      )}
      {tab === 'dues' && (
        <div className="card">
          <Table head={['Student', 'Class', 'Due', 'Overdue', '', '']} empty="No dues. Every family is paid up." rows={open.map((d) => [<b key="n">{d.name}</b>, d.classLabel, <span key="a" className="num">{inr(balance(d))}{balance(d) < d.due && <span className="dim small"> of {inr(d.due)}</span>}</span>, <span key="o" className={`pill ${d.days > 30 ? 'bad' : d.days > 10 ? 'warn' : ''}`}>{d.days} days</span>,
            linked.includes(d.id) ? <span key="l" className="pill ok">✓ UPI link sent</span> : <button key="l" className="btn sm ghost" onClick={() => { setLinked([...linked, d.id]); toast(`UPI link for ${inr(balance(d))} sent to ${d.guardian.name}.`); }}>Send UPI link</button>,
            <button key="p" className="btn sm quiet" onClick={() => startPay(d)}>Record payment</button>])} />
          {payments.length > 0 && <><div className="card-head" style={{ marginTop: 18 }}><h3>Recorded today</h3></div><Table head={['Receipt', 'Student', 'Amount', 'Mode', 'Date', '']} rows={payments.map((p) => [<b key="n" className="num">{p.no}</b>, allDues.find((d) => d.id === p.id)?.name ?? '', <span key="a" className="num">{inr(p.amount)}</span>, p.ref ? `${p.mode} · ${p.ref}` : p.mode, formatDate(p.date), <button key="u" className="btn sm ghost" onClick={() => void undoPay(p)}>Cancel receipt</button>])} /></>}
        </div>
      )}
      <Modal open={!!paying} onClose={() => setPaying(null)} title={`Record payment · ${paying?.name ?? ''}`}>
        {paying && (
          <form className="stack" style={{ gap: 12 }} onSubmit={(e) => { e.preventDefault(); record(); }}>
            <p className="muted small">Due: {inr(balance(paying))}. Part payments are fine; the rest stays due.</p>
            <div className="grid cols-2" style={{ gap: 12 }}>
              <div className="field"><label htmlFor="fp-a">Amount received (₹)</label><input id="fp-a" className="input" type="number" min={1} max={balance(paying)} required value={pf.amount} onChange={(e) => setPf({ ...pf, amount: e.target.value })} /></div>
              <div className="field"><label htmlFor="fp-d">Date received</label><input id="fp-d" className="input" type="date" max={day(0)} required value={pf.date} onChange={(e) => setPf({ ...pf, date: e.target.value })} /></div>
              <div className="field"><span className="label">Mode</span><Seg label="Mode" value={pf.mode} onChange={(v) => setPf({ ...pf, mode: v })} options={['Cash', 'UPI', 'Cheque'].map((m) => ({ value: m, label: m }))} /></div>
              {pf.mode !== 'Cash' && <div className="field"><label htmlFor="fp-r">{pf.mode === 'Cheque' ? 'Cheque number' : 'UPI reference'}</label><input id="fp-r" className="input" required value={pf.ref} onChange={(e) => setPf({ ...pf, ref: e.target.value })} /></div>}
            </div>
            <div className="row"><button className="btn">Record and send receipt</button><button type="button" className="btn ghost" onClick={() => setPaying(null)}>Cancel</button></div>
          </form>
        )}
      </Modal>
      <ExportModal title="Tally export · fee receipts" filename="tally-fee-receipts.csv" head={['Voucher', 'Date', 'Student', 'Class', 'Type', 'Mode', 'Amount (₹)']} rows={vouchers} open={tally} onClose={() => setTally(false)} note={`${vouchers.length} vouchers, ledger “Fee income”. Exported ${exports.length} time(s).`} />
      {tab === 'collection' && (
        <div className="grid cols-2">
          <div className="card"><div className="card-head"><h3>By class</h3><span className="dim small">Billed this term from the fee structure</span></div><Table head={['Class', 'Students', 'Billed', 'Collected', 'Due', '']} rows={[...new Set(roster.map((s) => s.classLabel))].filter(inFilter).sort().map((c) => {
            const kids = roster.filter((s) => s.classLabel === c);
            const billed = kids.length * (structure[standardOf(c)] ?? []).filter((h) => !h.optional).reduce((t, h) => t + h.amount, 0) / 3;
            const due = allDues.filter((d) => d.classLabel === c).reduce((t, d) => t + balance(d), 0);
            const got = billed - due;
            return [<b key="c">{c}</b>, kids.length, <span key="b" className="num">{inr(billed)}</span>, <span key="g" className="num">{inr(got)}</span>, <span key="d" className="num">{inr(due)}</span>, <div key="p" style={{ minWidth: 100 }}><Bar value={billed ? Math.round((got / billed) * 100) : 0} label="" thresholds={[60, 80]} /></div>];
          })} /></div>
          <div className="card"><div className="card-head"><h3>Latest receipts</h3></div><div className="list">{['Abinaya S', 'Harini K', 'Pranav S', 'Divya P', 'Swetha J'].map((n, i) => <div key={n} className="row between"><span><b>{n}</b><div className="dim small">R-2026-04{17 - i} · {i % 2 ? 'Cash' : 'UPI'}</div></span><span className="num">{inr(pick([18500, 14000, 1200], i))}</span></div>)}</div></div>
        </div>
      )}
      {tab === 'structure' && (
        <div className="grid cols-2">
          <div className="card stack" style={{ gap: 12 }}>
            <div className="card-head" style={{ margin: 0 }}><h3>Fee structure · 2026–27</h3>{dirty && <span className="pill warn">Unsaved changes</span>}</div>
            <Seg label="Standard" value={fsStd} onChange={async (v) => { if (dirty && !(await ask({ title: `Discard changes to ${fsStd}?`, body: 'The changes you made to this standard are not saved yet.', confirm: 'Discard changes', danger: true }))) return; setDraft(null); setFsStd(v); }} options={STANDARDS.map((x) => ({ value: x, label: x }))} />
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Head</th><th className="r">Amount (₹ a year)</th><th>When</th><th>Optional</th><th /></tr></thead>
              <tbody>
                {heads.map((h, i) => (
                  <tr key={i}>
                    <td><input aria-label="Fee head" className="input" value={h.head} onChange={(e) => editHead(i, { head: e.target.value })} /></td>
                    <td className="r"><input aria-label={`${h.head} amount`} type="number" min={0} step={100} className="input num" style={{ width: 110 }} value={h.amount} onChange={(e) => editHead(i, { amount: Number(e.target.value) })} /></td>
                    <td><input aria-label={`${h.head} when`} className="input" value={h.when} onChange={(e) => editHead(i, { when: e.target.value })} /></td>
                    <td><input type="checkbox" aria-label={`${h.head} optional`} checked={!!h.optional} onChange={(e) => editHead(i, { optional: e.target.checked })} /></td>
                    <td><button className="btn sm quiet" aria-label={`Remove ${h.head}`} onClick={() => setDraft(heads.filter((_, j) => j !== i))}>Remove</button></td>
                  </tr>
                ))}
                <tr><td><b>Total (compulsory)</b></td><td className="r num"><b>{inr(heads.filter((h) => !h.optional).reduce((t, h) => t + (h.amount || 0), 0))}</b></td><td colSpan={3} className="dim small">Optional heads (like transport) are billed only to families who use them.</td></tr>
              </tbody>
            </table></div>
            <div className="row">
              <button className="btn ghost" onClick={() => setDraft([...heads, { head: '', amount: 0, when: 'June' }])}><Icon name="plus" size={18} />Add head</button>
              <button className="btn" disabled={!dirty} onClick={() => void saveStructure()}>Save changes</button>
              {dirty && <button className="btn quiet" onClick={() => setDraft(null)}>Discard</button>}
            </div>
            {history.length > 0 && <div className="stack" style={{ gap: 6 }}><span className="eyebrow">Change log</span>{history.slice(0, 5).map((x, i) => <span key={i} className="small"><b>{x.standard}</b> · {relTime(x.at)}: <span className="muted">{x.change}</span></span>)}</div>}
          </div>
          <div className="card stack"><h3>Rules</h3><div className="list">{[['Late fee', '₹50 a week after 10 days, capped at ₹500'], ['Sibling concession', '10% on tuition for the second child'], ['Staff ward', '50% on tuition'], ['RTE 25%', 'Fully waived, claimed from the government']].map(([k, v]) => <div key={k}><b>{k}</b><div className="muted small">{v}</div></div>)}</div></div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- admissions

const STAGES = ['Enquiry', 'Visited', 'Entrance test', 'Admitted'] as const;
type Lead = { id: string; child: string; parent: string; grade: string; source: string; stage: typeof STAGES[number]; rte?: boolean; note: string };
const LEADS: Lead[] = [
  { id: 'l1', child: 'Nila R', parent: 'Mr. Rajesh', grade: 'LKG', source: 'Website', stage: 'Enquiry', note: 'Asked about the school bus' },
  { id: 'l2', child: 'Aditya S', parent: 'Mrs. Sangeetha', grade: '6', source: 'WhatsApp', stage: 'Enquiry', note: 'Moving from a CBSE school' },
  { id: 'l3', child: 'Thamizh K', parent: 'Mr. Kumar', grade: '1', source: 'Walk-in', stage: 'Visited', rte: true, note: 'RTE lottery: selected' },
  { id: 'l4', child: 'Riya M', parent: 'Mrs. Malathi', grade: '11', source: 'Website', stage: 'Entrance test', note: 'Wants Maths–CS; test on ' + dayLabel(3) },
  { id: 'l5', child: 'Sanjay P', parent: 'Mr. Prabhu', grade: '9', source: 'Referral', stage: 'Visited', note: 'Sibling in 6-B' },
  { id: 'l6', child: 'Aarthi V', parent: 'Mrs. Vimala', grade: 'LKG', source: 'WhatsApp', stage: 'Admitted', rte: true, note: 'Documents verified' },
  { id: 'l7', child: 'Kabilan J', parent: 'Mr. Jayakumar', grade: '11', source: 'Walk-in', stage: 'Admitted', note: 'Commerce group' },
];

export function Admissions() {
  const { toast } = useApp();
  const [leads, setLeads] = useDemo<Lead[]>('leads', LEADS);
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [f, setF] = useState({ child: '', parent: '', grade: 'LKG', source: 'Walk-in' });
  const [ask, confirmEl] = useConfirm();
  const move = async (l: Lead, step: 1 | -1) => {
    const next = STAGES[Math.max(0, Math.min(STAGES.length - 1, STAGES.indexOf(l.stage) + step))];
    if (next === 'Admitted' && !(await ask({ title: `Admit ${l.child}?`, body: `This creates a student record and fee book for class ${l.grade} and sends ${l.parent} the admission letter on WhatsApp. Check the documents are verified first.`, confirm: 'Admit' }))) return;
    if (l.stage === 'Admitted' && !(await ask({ title: `Undo ${l.child}’s admission?`, body: 'The student record and fee book are withdrawn and the seat is freed. The parent is told.', confirm: 'Undo admission', danger: true }))) return;
    setLeads(leads.map((x) => (x.id === l.id ? { ...x, stage: next } : x)));
    toast(next === 'Admitted' ? `${l.child} admitted. Student record and fee book created.` : step < 0 ? `${l.child} moved back to ${next}.` : `${l.child} moved to ${next}. ${l.parent} got a WhatsApp update.`);
  };
  const remove = async (l: Lead) => {
    if (!(await ask({ title: `Close ${l.child}’s enquiry?`, body: 'Use this when the family is no longer interested. The enquiry is removed from the pipeline.', confirm: 'Close enquiry', danger: true }))) return;
    setLeads(leads.filter((x) => x.id !== l.id));
    toast('Enquiry closed.');
  };
  return (
    <>
      {confirmEl}
      <PageHead eyebrow="Admissions" title="Enquiries and admissions" lede="Enquiries from the website, WhatsApp and walk-ins in one pipeline, with online applications, document upload, entrance tests and RTE 25% records.">
        <button className="btn" onClick={() => { setEditId(null); setF({ child: '', parent: '', grade: 'LKG', source: 'Walk-in' }); setOpen(true); }}><Icon name="plus" size={18} />New enquiry</button>
      </PageHead>
      <Stats items={[{ label: 'Enquiries this season', value: 312 + leads.length - LEADS.length }, { label: 'Converted', value: '38%' }, { label: 'RTE seats filled', value: '24 of 25' }, { label: 'Seats left', value: 41, foot: 'Mostly classes 6 and 11' }]} />
      <div className="kanban">
        {STAGES.map((st) => (
          <div key={st}>
            <div className="row between"><b>{st}</b><span className="pill">{leads.filter((l) => l.stage === st).length}</span></div>
            {leads.filter((l) => l.stage === st).map((l) => (
              <div key={l.id} className="kcard">
                <div className="row between"><b>{l.child}</b><span className="dim small">Class {l.grade}</span></div>
                <span className="muted small">{l.parent} · {l.source}</span>
                <span className="small">{l.note}</span>
                {l.rte && <span className="pill accent" style={{ alignSelf: 'flex-start' }}>RTE 25%</span>}
                <div className="row" style={{ gap: 6 }}>
                  {st !== 'Enquiry' && <button className="btn sm quiet" aria-label={`Move ${l.child} back`} onClick={() => void move(l, -1)}>Back</button>}
                  {st === 'Enquiry' && <button className="btn sm quiet" onClick={() => void remove(l)}>Close</button>}
                  <button className="btn sm quiet" aria-label={`Edit ${l.child}`} onClick={() => { setEditId(l.id); setF({ child: l.child, parent: l.parent, grade: l.grade, source: l.source }); setOpen(true); }}>Edit</button>
                  {st !== 'Admitted' && <button className="btn sm ghost" style={{ marginLeft: 'auto' }} onClick={() => void move(l, 1)}>{st === 'Entrance test' ? 'Admit' : 'Next'}<Icon name="arrow" size={14} /></button>}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title={editId ? 'Edit enquiry' : 'New enquiry'}>
        <form className="stack" style={{ gap: 12 }} onSubmit={(e) => { e.preventDefault(); if (!f.child.trim() || !f.parent.trim()) return toast('Add the child’s and parent’s names.', 'err'); if (editId) { setLeads(leads.map((x) => (x.id === editId ? { ...x, child: f.child.trim(), parent: f.parent.trim(), grade: f.grade, source: f.source } : x))); setOpen(false); toast('Enquiry updated.'); return; } setLeads([{ id: `l${Date.now()}`, ...f, stage: 'Enquiry', note: 'Brochure and fee details sent on WhatsApp' }, ...leads]); setOpen(false); toast('Enquiry added. Brochure sent on WhatsApp.'); setF({ child: '', parent: '', grade: 'LKG', source: 'Walk-in' }); }}>
          <div className="grid cols-2" style={{ gap: 12 }}>
            <div className="field"><label htmlFor="e-c">Child’s name</label><input id="e-c" className="input" required value={f.child} onChange={(e) => setF({ ...f, child: e.target.value })} /></div>
            <div className="field"><label htmlFor="e-p">Parent</label><input id="e-p" className="input" required value={f.parent} onChange={(e) => setF({ ...f, parent: e.target.value })} /></div>
            <div className="field"><span className="label">Class</span><select aria-label="Class" className="input" value={f.grade} onChange={(e) => setF({ ...f, grade: e.target.value })}>{['LKG', 'UKG', '1', '6', '9', '11'].map((g) => <option key={g}>{g}</option>)}</select></div>
            <div className="field"><span className="label">Source</span><select aria-label="Source" className="input" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}>{['Walk-in', 'Website', 'WhatsApp', 'Referral'].map((g) => <option key={g}>{g}</option>)}</select></div>
          </div>
          <button className="btn">{editId ? 'Save changes' : 'Add enquiry'}</button>
        </form>
      </Modal>
    </>
  );
}

// ---------------------------------------------------------------- transport, pickup, visitors, gate

type Stop = { name: string; time: string; students: number };
type Route = { id: string; name: string; stops: Stop[] };
type Bus = { no: string; routeId: string; driver: string; driverPhone: string; attendant: string; seats: number };
const mkStops = (names: string[], start: string, counts: number[]): Stop[] => {
  const [h, m] = start.split(':').map(Number);
  return names.map((name, i) => { const t = h * 60 + m + i * 6; return { name, time: `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`, students: counts[i] ?? 0 }; });
};
const ROUTES: Route[] = [
  { id: 'r4', name: 'Route 4', stops: mkStops(['Temple junction', 'Bus stand', 'Market road', 'Water tank', 'Post office', 'Hospital corner', 'Railway gate', 'Park entrance', 'Mill road'], '6:55', [5, 6, 4, 7, 5, 4, 6, 3, 2]) },
  { id: 'r7', name: 'Route 7', stops: mkStops(['North colony', 'Lake view', 'Bank street', 'Old bridge', 'Weavers street', 'Library', 'Petrol bunk', 'College road', 'Church street', 'Market', 'Ring road'], '6:40', [4, 3, 5, 3, 4, 3, 4, 3, 4, 3, 2]) },
  { id: 'r2', name: 'Route 2', stops: mkStops(['East gate', 'Police quarters', 'Rice mill', 'Panchayat office', 'New colony', 'Bakery corner', 'Main road'], '7:05', [5, 4, 6, 4, 5, 4, 3]) },
];
const BUSES: Bus[] = [
  { no: 'TN 38 AB 1234', routeId: 'r4', driver: 'Mr. Selvam', driverPhone: '9840011122', attendant: 'Mrs. Kala', seats: 45 },
  { no: 'TN 38 CD 5678', routeId: 'r7', driver: 'Mr. Anbu', driverPhone: '9840033344', attendant: 'Mrs. Rani', seats: 40 },
  { no: 'TN 38 EF 9012', routeId: 'r2', driver: 'Mr. Ramesh', driverPhone: '9840055566', attendant: 'Mrs. Devi', seats: 35 },
];
const riders = (r?: Route) => (r ? r.stops.reduce((a, x) => a + x.students, 0) : 0);
const PLATE = /^[A-Z]{2} ?\d{1,2} ?[A-Z]{0,3} ?\d{1,4}$/;
const PATH = 'M30 200 C 90 160, 120 60, 200 70 S 320 150, 380 110 S 470 40, 540 60';

export function BusMap({ label = 'Route 4' }: { label?: string }) {
  const [t, setT] = useState(0.35);
  useEffect(() => { const id = window.setInterval(() => setT((x) => (x >= 0.96 ? 0.1 : x + 0.004)), 120); return () => window.clearInterval(id); }, []);
  const [pt, setPt] = useState({ x: 0, y: 0 });
  useEffect(() => { const p = document.getElementById('bus-path') as unknown as SVGPathElement | null; if (p) { const L = p.getTotalLength(); const q = p.getPointAtLength(L * t); setPt({ x: q.x, y: q.y }); } }, [t]);
  return (
    <svg viewBox="0 0 570 240" style={{ width: '100%', height: 'auto', background: 'var(--bg-2)', borderRadius: 16 }} role="img" aria-label={`Sample map: ${label} bus position`}>
      {[40, 100, 160, 220].map((y) => <line key={y} x1="0" x2="570" y1={y} y2={y} stroke="var(--line)" />)}
      {[80, 200, 320, 440].map((x) => <line key={x} y1="0" y2="240" x1={x} x2={x} stroke="var(--line)" />)}
      <path id="bus-path" d={PATH} fill="none" stroke="var(--line-2)" strokeWidth="10" strokeLinecap="round" />
      <path d={PATH} fill="none" stroke="var(--school-accent)" strokeWidth="3" strokeDasharray="2 8" strokeLinecap="round" />
      {[[30, 200], [128, 96], [200, 70], [300, 128], [380, 110], [540, 60]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="6" fill="var(--sf)" stroke="var(--school)" strokeWidth="2" />)}
      <text x="540" y="40" textAnchor="middle" fontSize="12" fill="var(--mu)">School</text>
      <g transform={`translate(${pt.x},${pt.y})`}><circle r="13" fill="var(--school)" /><text y="4" textAnchor="middle" fontSize="11" fill="var(--on-school)" fontWeight="700">{label.replace(/\D/g, '').slice(-2) || 'B'}</text></g>
    </svg>
  );
}

type Gate = { name: string; cls: string; at: string; dir: 'In' | 'Out'; by: string };
export function Transport() {
  const { toast } = useApp();
  const roster = useRoster();
  const [tab, setTab] = useState<'live' | 'buses' | 'routes' | 'pickup' | 'gate'>('live');
  const [buses, setBuses] = useDemo<Bus[]>('buses', BUSES);
  const [routes, setRoutes] = useDemo<Route[]>('routes', ROUTES);
  const [editBus, setEditBus] = useState<null | { at: number | null }>(null);
  const [editRoute, setEditRoute] = useState<null | { at: number | null }>(null);
  const [openRoute, setOpenRoute] = useState(routes[0]?.id ?? '');
  const [ask, confirmEl] = useConfirm();
  const routeOf = (id: string) => routes.find((r) => r.id === id);
  const busOn = (id: string) => buses.find((b) => b.routeId === id);
  const removeBus = async (i: number) => {
    const b = buses[i];
    const r = routeOf(b.routeId);
    if (!(await ask({ title: `Remove bus ${b.no}?`, body: <>{r ? `${r.name} will have no bus, and its ${riders(r)} students' parents stop getting live bus alerts until you put another bus on it.` : 'It is not on any route.'} You can add it again later.</>, confirm: 'Remove bus', danger: true }))) return;
    setBuses(buses.filter((_, j) => j !== i));
    toast(`${b.no} removed.`);
  };
  const removeRoute = async (r: Route) => {
    const b = busOn(r.id);
    if (b) { toast(`${b.no} runs on ${r.name}. Move the bus to another route first.`, 'err'); return; }
    if (!(await ask({ title: `Remove ${r.name}?`, body: `Its ${r.stops.length} stops and ${riders(r)} student pickups will be removed.`, confirm: 'Remove route', danger: true }))) return;
    setRoutes(routes.filter((x) => x.id !== r.id));
    toast(`${r.name} removed.`);
  };
  const live = buses.map((b, i) => ({ b, r: routeOf(b.routeId), status: i % 3 === 2 ? 'Reached school' : `${[6, 14][i % 3]} min away` }));
  const sel = routeOf(openRoute) ?? routes[0];
  const [gate, setGate] = useDemo<Gate[]>('gate-log', []);
  const [pickupCls, setPickupCls] = useState('10-A');
  const [visitor, setVisitor] = useState({ name: '', purpose: 'Meet class advisor', to: 'Mrs. R. Lakshmi' });
  const [pass, setPass] = useState<null | typeof visitor & { no: string }>(null);
  const scan = () => { const s = roster[(gate.length * 7) % Math.max(1, roster.length)]; if (!s) return; const at = new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }); setGate([{ name: s.name, cls: s.classLabel, at, dir: 'In', by: 'ID card QR' }, ...gate]); toast(`${s.name} checked in at ${at}. Parent told on WhatsApp.`); };
  return (
    <>
      <PageHead eyebrow="Transport and safety" title="Buses, pickups and the gate" lede="Live bus position with a “5 minutes away” alert, routes and stops, authorised pickup lists, visitor passes and gate check-in by ID card QR." />
      {confirmEl}
      <BusModal open={!!editBus} bus={editBus?.at != null ? buses[editBus.at] : null} routes={routes} taken={buses.filter((_, j) => j !== editBus?.at).map((b) => b.no)} onClose={() => setEditBus(null)}
        onSave={(b) => { if (editBus?.at != null) { setBuses(buses.map((x, j) => (j === editBus.at ? b : x))); toast(`${b.no} updated.`); } else { setBuses([...buses, b]); toast(`${b.no} added to ${routeOf(b.routeId)?.name ?? 'no route'}.`); } setEditBus(null); }} />
      <RouteModal open={!!editRoute} route={editRoute?.at != null ? routes[editRoute.at] : null} names={routes.filter((_, j) => j !== editRoute?.at).map((r) => r.name.toLowerCase())} onClose={() => setEditRoute(null)}
        onSave={(r) => { if (editRoute?.at != null) { setRoutes(routes.map((x, j) => (j === editRoute.at ? r : x))); toast(`${r.name} updated.`); } else { setRoutes([...routes, r]); toast(`${r.name} added. Put a bus on it from the Buses tab.`); } setOpenRoute(r.id); setEditRoute(null); }} />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'live', label: 'Live buses' }, { value: 'buses', label: `Buses (${buses.length})` }, { value: 'routes', label: `Routes (${routes.length})` }, { value: 'pickup', label: 'Pickup and visitors' }, { value: 'gate', label: 'Gate check-in' }]} />
      {tab === 'live' && (
        <div className="split" style={{ alignItems: 'start' }}>
          <div className="card stack"><div className="card-head" style={{ margin: 0 }}><h2>{live[0]?.r?.name ?? 'Bus'} · morning run</h2><span className="pill accent"><span className="dot" />Live (sample)</span></div><BusMap label={live[0]?.r?.name} /><span className="dim small">Parents at the next stop got: “The bus is 5 minutes away.”</span></div>
          <div className="card">{live.length === 0 ? <div className="empty">No buses yet. Add one in the Buses tab.</div> : <div className="list">{live.map(({ b, r, status }) => <div key={b.no}><div className="row between"><b>{r?.name ?? 'No route'}</b><span className={`pill ${status === 'Reached school' ? 'ok' : 'accent'}`}>{r ? status : 'Not running'}</span></div><div className="muted small">{b.no} · {b.driver} · {riders(r)} students</div></div>)}</div>}</div>
        </div>
      )}
      {tab === 'buses' && (
        <div className="card">
          <div className="card-head"><h2>Buses</h2><button className="btn sm" onClick={() => setEditBus({ at: null })}><Icon name="plus" size={16} />Add bus</button></div>
          <Table head={['Bus', 'Route', 'Driver', 'Attendant', 'Seats', 'Students', '']} empty="No buses yet. Add the first one."
            rows={buses.map((b, i) => { const r = routeOf(b.routeId); const n = riders(r); return [
              <b key="n" className="num">{b.no}</b>,
              r ? <button key="r" className="btn sm ghost" onClick={() => { setOpenRoute(r.id); setTab('routes'); }}>{r.name}</button> : <span key="r" className="pill warn">No route</span>,
              <span key="d">{b.driver}<div className="dim small num">{b.driverPhone}</div></span>,
              b.attendant || <span key="a" className="dim">–</span>,
              b.seats,
              n > b.seats ? <span key="s" className="pill bad">{n} · over by {n - b.seats}</span> : <span key="s">{n}</span>,
              <span key="x" className="row" style={{ gap: 6, flexWrap: 'nowrap' }}><button className="btn sm ghost" onClick={() => setEditBus({ at: i })}>Edit</button><button className="btn sm ghost" onClick={() => removeBus(i)}>Remove</button></span>,
            ]; })} />
        </div>
      )}
      {tab === 'routes' && (
        <div className="split" style={{ alignItems: 'start' }}>
          <div className="card">
            <div className="card-head"><h2>Routes</h2><button className="btn sm" onClick={() => setEditRoute({ at: null })}><Icon name="plus" size={16} />Add route</button></div>
            <Table head={['Route', 'Bus', 'Stops', 'Students', 'First pickup']} empty="No routes yet."
              rows={routes.map((r) => { const b = busOn(r.id); return [
                <button key="r" className="btn sm ghost" aria-pressed={sel?.id === r.id} onClick={() => setOpenRoute(r.id)}><b>{r.name}</b></button>,
                b ? b.no : <span key="b" className="pill warn">No bus</span>, r.stops.length, riders(r), r.stops[0]?.time ?? '–']; })} />
          </div>
          {sel && (() => { const b = busOn(sel.id); const n = riders(sel); return (
            <div className="card stack">
              <div className="card-head" style={{ margin: 0 }}><h2>{sel.name}</h2><span className="row" style={{ gap: 6 }}><button className="btn sm ghost" onClick={() => setEditRoute({ at: routes.indexOf(sel) })}>Edit stops</button><button className="btn sm ghost" onClick={() => removeRoute(sel)}>Remove</button></span></div>
              <div className="muted small">{b ? `${b.no} · ${b.driver} (${b.driverPhone})${b.attendant ? ` · attendant ${b.attendant}` : ''}` : 'No bus on this route yet.'}</div>
              {b && n > b.seats && <div className="pill bad" style={{ alignSelf: 'flex-start' }}>{n} students but only {b.seats} seats</div>}
              <ol className="list" style={{ margin: 0, paddingLeft: 0, listStyle: 'none' }}>
                {sel.stops.map((x, i) => <li key={i} className="row between"><span><span className="pill" style={{ marginRight: 8 }}>{i + 1}</span>{x.name}</span><span className="dim small num">{x.time} · {x.students} students</span></li>)}
                <li className="row between"><span><span className="pill ok" style={{ marginRight: 8 }}>✓</span><b>School</b></span><span className="dim small num">{n} students</span></li>
              </ol>
            </div>
          ); })()}
        </div>
      )}
      {tab === 'pickup' && (
        <div className="grid cols-2">
          <div className="card"><div className="card-head"><h3>Authorised pickup</h3><select aria-label="Class" className="input" style={{ width: 'auto' }} value={pickupCls} onChange={(e) => setPickupCls(e.target.value)}>{[...new Set(roster.map((s) => s.classLabel))].map((c) => <option key={c}>{c}</option>)}</select></div><div className="list">{roster.filter((s) => s.classLabel === pickupCls).map((s, i) => <div key={s.id} className="row between"><span><b>{s.name}</b><div className="muted small">{s.guardian.name} ({s.guardian.relation}){i % 2 ? ', Grandfather' : ''}</div></span>{i === 3 ? <span className="pill warn">Bus only</span> : <span className="pill ok">{i % 2 ? 2 : 1} people</span>}</div>)}</div></div>
          <div className="card stack">
            <h3>Visitor pass</h3>
            {pass ? (
              <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}><QR text={pass.no} size={110} /><div className="stack" style={{ gap: 4 }}><b className="num">{pass.no}</b><span>{pass.name}</span><span className="muted small">{pass.purpose} · {pass.to}</span><span className="dim small">Valid today until 5:00 pm</span><button className="btn sm ghost" onClick={() => setPass(null)}>New pass</button></div></div>
            ) : (
              <form className="stack" onSubmit={(e) => { e.preventDefault(); if (!visitor.name) return; setPass({ ...visitor, no: `VP-${String(Date.now()).slice(-5)}` }); toast(`Pass issued. ${visitor.to} was told on WhatsApp.`); }}>
                <div className="field"><label htmlFor="v-n">Visitor</label><input id="v-n" className="input" required value={visitor.name} onChange={(e) => setVisitor({ ...visitor, name: e.target.value })} placeholder="Name and mobile" /></div>
                <div className="field"><label htmlFor="v-p">Purpose</label><input id="v-p" className="input" value={visitor.purpose} onChange={(e) => setVisitor({ ...visitor, purpose: e.target.value })} /></div>
                <div className="field"><label htmlFor="v-t">To meet</label><select id="v-t" className="input" value={visitor.to} onChange={(e) => setVisitor({ ...visitor, to: e.target.value })}>{STAFF.map((x) => <option key={x.name} value={x.name}>{x.name} · {x.role}</option>)}</select></div>
                <button className="btn">Issue pass</button>
              </form>
            )}
          </div>
        </div>
      )}
      {tab === 'gate' && (
        <div className="split" style={{ alignItems: 'start' }}>
          <div className="card"><div className="card-head"><h3>Today at the gate</h3><span className="dim small">{gate.length + 384} check-ins</span></div><Table head={['Student', 'Class', 'Time', 'How']} rows={gate.map((g) => [<b key="n">{g.name}</b>, g.cls, g.at, g.by])} empty="Scan an ID card to see check-ins here." /></div>
          <div className="card stack" style={{ alignItems: 'center', textAlign: 'center' }}><QR text="gate" /><button className="btn" onClick={scan}><Icon name="qr" size={18} />Scan an ID card</button><span className="dim small">Works with ID card QR, RFID readers or face recognition. Check-in also marks attendance.</span></div>
        </div>
      )}
    </>
  );
}

function BusModal({ open, bus, routes, taken, onClose, onSave }: { open: boolean; bus: Bus | null; routes: Route[]; taken: string[]; onClose: () => void; onSave: (b: Bus) => void }) {
  const blank: Bus = { no: '', routeId: '', driver: '', driverPhone: '', attendant: '', seats: 40 };
  const [f, setF] = useState<Bus>(bus ?? blank);
  useEffect(() => { if (open) setF(bus ?? blank); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const no = f.no.trim().toUpperCase().replace(/\s+/g, ' ');
  const problem = !no ? 'Enter the bus number plate.' : !PLATE.test(no) ? 'Number plate looks wrong. Example: TN 38 AB 1234.' : taken.includes(no) ? 'Another bus already has this number plate.'
    : !f.driver.trim() ? "Enter the driver's name." : !/^[6-9]\d{9}$/.test(f.driverPhone) ? "Driver's mobile must be 10 digits." : !(f.seats >= 10 && f.seats <= 80) ? 'Seats must be between 10 and 80.' : null;
  const set = <K extends keyof Bus>(k: K, v: Bus[K]) => setF({ ...f, [k]: v });
  return (
    <Modal open={open} onClose={onClose} title={bus ? `Edit bus ${bus.no}` : 'Add a bus'}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); if (!problem) onSave({ ...f, no, driver: f.driver.trim(), attendant: f.attendant.trim() }); }}>
        <div className="grid cols-2" style={{ gap: 12 }}>
          <div className="field"><label htmlFor="bus-no">Number plate</label><input id="bus-no" className="input" placeholder="TN 38 AB 1234" value={f.no} onChange={(e) => set('no', e.target.value)} /></div>
          <div className="field"><label htmlFor="bus-seats">Seats</label><input id="bus-seats" type="number" min={10} max={80} className="input" value={f.seats} onChange={(e) => set('seats', Number(e.target.value))} /></div>
          <div className="field"><label htmlFor="bus-driver">Driver</label><input id="bus-driver" className="input" placeholder="Mr. Kumar" value={f.driver} onChange={(e) => set('driver', e.target.value)} /></div>
          <div className="field"><label htmlFor="bus-phone">Driver's mobile</label><input id="bus-phone" className="input" inputMode="numeric" maxLength={10} placeholder="10 digits" value={f.driverPhone} onChange={(e) => set('driverPhone', e.target.value.replace(/\D/g, ''))} /></div>
          <div className="field"><label htmlFor="bus-att">Attendant (optional)</label><input id="bus-att" className="input" value={f.attendant} onChange={(e) => set('attendant', e.target.value)} /></div>
          <div className="field"><label htmlFor="bus-route">Route</label><select id="bus-route" className="input" value={f.routeId} onChange={(e) => set('routeId', e.target.value)}><option value="">Not on a route yet</option>{routes.map((r) => <option key={r.id} value={r.id}>{r.name} · {r.stops.length} stops, {riders(r)} students</option>)}</select></div>
        </div>
        {!problem && f.routeId && riders(routes.find((r) => r.id === f.routeId)) > f.seats && <div className="pill warn" style={{ alignSelf: 'flex-start' }}>{riders(routes.find((r) => r.id === f.routeId))} students on this route but {f.seats} seats</div>}
        {problem && f.no && <div className="small" style={{ color: 'var(--bad)' }}>{problem}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn" disabled={!!problem}>{bus ? 'Save changes' : 'Add bus'}</button></div>
      </form>
    </Modal>
  );
}

function RouteModal({ open, route, names, onClose, onSave }: { open: boolean; route: Route | null; names: string[]; onClose: () => void; onSave: (r: Route) => void }) {
  const blank = (): Route => ({ id: `r${Date.now().toString(36)}`, name: '', stops: [{ name: '', time: '7:00', students: 0 }] });
  const [f, setF] = useState<Route>(route ?? blank());
  useEffect(() => { if (open) setF(route ?? blank()); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const setStop = (i: number, p: Partial<Stop>) => setF({ ...f, stops: f.stops.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const mins = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const problem = !f.name.trim() ? 'Give the route a name.' : names.includes(f.name.trim().toLowerCase()) ? 'Another route already has this name.'
    : f.stops.some((x) => !x.name.trim()) ? 'Every stop needs a name.' : f.stops.some((x) => !/^\d{1,2}:\d{2}$/.test(x.time)) ? 'Pickup times look like 7:05.'
    : f.stops.some((x, i) => i > 0 && mins(x.time) < mins(f.stops[i - 1].time)) ? 'Pickup times must go in order, earliest first.' : null;
  return (
    <Modal open={open} onClose={onClose} title={route ? `Edit ${route.name}` : 'Add a route'} wide>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); if (!problem) onSave({ ...f, name: f.name.trim(), stops: f.stops.map((x) => ({ ...x, name: x.name.trim() })) }); }}>
        <div className="field"><label htmlFor="rt-name">Route name</label><input id="rt-name" className="input" placeholder="Route 9" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div className="table-wrap"><table className="table">
          <thead><tr><th>#</th><th>Stop</th><th>Pickup time</th><th>Students</th><th /></tr></thead>
          <tbody>{f.stops.map((x, i) => (
            <tr key={i}>
              <td className="num">{i + 1}</td>
              <td><input aria-label={`Stop ${i + 1} name`} className="input" value={x.name} onChange={(e) => setStop(i, { name: e.target.value })} /></td>
              <td><input aria-label={`Stop ${i + 1} time`} type="time" className="input" value={x.time.padStart(5, '0')} onChange={(e) => setStop(i, { time: e.target.value.replace(/^0(\d)/, '$1') })} /></td>
              <td><input aria-label={`Stop ${i + 1} students`} type="number" min={0} className="input" style={{ width: 80 }} value={x.students} onChange={(e) => setStop(i, { students: Math.max(0, Number(e.target.value) || 0) })} /></td>
              <td><button type="button" className="btn sm ghost" disabled={f.stops.length === 1} onClick={() => setF({ ...f, stops: f.stops.filter((_, j) => j !== i) })}>Remove</button></td>
            </tr>
          ))}</tbody>
        </table></div>
        <div className="row between"><button type="button" className="btn sm ghost" onClick={() => { const last = f.stops[f.stops.length - 1]; const t = mins(last?.time ?? '7:00') + 6; setF({ ...f, stops: [...f.stops, { name: '', time: `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`, students: 0 }] }); }}><Icon name="plus" size={16} />Add stop</button><span className="dim small">{f.stops.length} stops · {riders(f)} students</span></div>
        {problem && <div className="small" style={{ color: 'var(--bad)' }}>{problem}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn" disabled={!!problem}>{route ? 'Save route' : 'Add route'}</button></div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- staff: attendance, leave, payroll, appraisal

type StaffRow = { name: string; role: string; basic: number; in: string; status: string; phone?: string };
const STAFF: StaffRow[] = [
  { name: 'Mr. K. Karthik', role: 'Maths', basic: 38000, in: '8:12', status: 'Present' }, { name: 'Mrs. R. Lakshmi', role: 'Science', basic: 41000, in: '', status: 'On leave' },
  { name: 'Mr. P. Rajan', role: 'Social Science', basic: 36000, in: '8:20', status: 'Present' }, { name: 'Mrs. V. Revathi', role: 'English', basic: 37000, in: '8:31', status: 'Late' },
  { name: 'Mr. A. Joseph', role: 'Physics', basic: 42000, in: '8:05', status: 'Present' }, { name: 'Mrs. S. Meena', role: 'Tamil', basic: 35000, in: '8:15', status: 'Present' },
  { name: 'Mr. Venkat', role: 'Office administrator', basic: 26000, in: '8:00', status: 'Present' }, { name: 'Ms. A. Fernandez', role: 'Counsellor', basic: 32000, in: '8:40', status: 'Present' },
];

export function Staff() {
  const { toast } = useApp();
  const [tab, setTab] = useState<'people' | 'attendance' | 'leave' | 'payroll' | 'appraisal'>('people');
  const [staff, setStaff] = useDemo<StaffRow[]>('staff-list', STAFF);
  const [edit, setEdit] = useState<null | { at: number | null; f: { name: string; role: string; basic: string; phone: string } }>(null);
  const [rec, setRec] = useState<null | { who: string; kind: string; from: string; to: string }>(null);
  const [leave, setLeave] = useDemo('staff-leave', [{ who: 'Mrs. S. Meena', days: `${dayLabel(6)} to ${dayLabel(8)}`, kind: 'Casual leave', status: 'Pending' }, { who: 'Mr. P. Rajan', days: dayLabel(10), kind: 'On duty: board training', status: 'Pending' }, { who: 'Mrs. R. Lakshmi', days: dayLabel(0), kind: 'Sick leave', status: 'Approved' }]);
  const [run, setRun] = useDemo('payroll-run', false);
  const [slip, setSlip] = useState<StaffRow | null>(null);
  const [bank, setBank] = useState(false);
  const [ask, confirmEl] = useConfirm();
  const decide = async (i: number, status: 'Approved' | 'Declined' | 'Pending') => {
    const l = leave[i];
    if (status === 'Declined' && !(await ask({ title: `Decline ${l.who}’s leave?`, body: `${l.kind}, ${l.days}. ${l.who.split(' ').slice(0, 2).join(' ')} is told on WhatsApp and can talk to you about it.`, confirm: 'Decline', danger: true }))) return;
    setLeave(leave.map((x, j) => (j === i ? { ...x, status } : x)));
    toast(status === 'Approved' ? `Approved. Substitutes will be suggested for ${l.who}’s periods.` : status === 'Declined' ? 'Declined.' : 'Decision undone. Back to pending.');
  };
  const runPayroll = async () => {
    const total = staff.reduce((t, s) => t + pay(s).net, 0);
    if (!(await ask({ title: 'Run this month’s payroll?', body: `Net pay of ${inr(total)} for ${staff.length} staff shown here. Payslips go to each person on WhatsApp. Check leave and attendance first; after the run, corrections are made as arrears next month.`, confirm: `Run payroll · ${inr(total)}` }))) return;
    setRun(true);
    toast('Payroll run. Payslips sent on WhatsApp; open any payslip below.');
  };
  const pay = (s: StaffRow) => { const al = Math.round(s.basic * 0.3), pf = Math.round(s.basic * 0.12), esi = s.basic < 21000 ? Math.round(s.basic * 0.0075) : 0; return { al, pf, esi, net: s.basic + al - pf - esi }; };
  return (
    <>
      {confirmEl}
      <PageHead eyebrow="Staff and HR" title="Staff" lede="Staff attendance from the biometric device, leave with approvals, monthly payroll with PF and ESI, and yearly appraisals." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'people', label: `Staff list (${staff.length})` }, { value: 'attendance', label: 'Attendance' }, { value: 'leave', label: 'Leave' }, { value: 'payroll', label: 'Payroll' }, { value: 'appraisal', label: 'Appraisal' }]} />
      {tab === 'people' && (
        <div className="card">
          <div className="card-head"><h2>Staff list</h2><button className="btn sm" onClick={() => setEdit({ at: null, f: { name: '', role: '', basic: '', phone: '' } })}><Icon name="plus" size={16} />Add staff member</button></div>
          <p className="dim small" style={{ marginBottom: 8 }}>Everyone on the payroll. A teacher’s classes, subjects and sign-in are set in Teachers.</p>
          <Table head={['Name', 'Role', 'Mobile', 'Basic pay', '']} empty="No staff yet." rows={staff.map((x, i) => [<b key="n">{x.name}</b>, x.role, <span key="p" className="num">{x.phone || '–'}</span>, <span key="b" className="num">{inr(x.basic)}</span>,
            <span key="a" className="row" style={{ gap: 4, flexWrap: 'nowrap' }}><button className="btn sm ghost" onClick={() => setEdit({ at: i, f: { name: x.name, role: x.role, basic: String(x.basic), phone: x.phone ?? '' } })}>Edit</button><button className="btn sm quiet" onClick={async () => { if (await ask({ title: `Remove ${x.name} from staff?`, body: 'They leave the staff list and are not in the next payroll run. Payslips already issued are kept.', confirm: 'Remove', danger: true })) { setStaff(staff.filter((_, j) => j !== i)); toast(`${x.name} removed from staff.`); } }}>Remove</button></span>])} />
        </div>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.at != null ? `Edit ${staff[edit.at]?.name}` : 'Add a staff member'}>
        {edit && (() => {
          const f = edit.f; const set = (k: keyof typeof f, v: string) => setEdit({ ...edit, f: { ...f, [k]: v } });
          const dup = staff.some((x, j) => j !== edit.at && x.name.toLowerCase() === f.name.trim().toLowerCase());
          const problem = !f.name.trim() ? 'Enter the name.' : dup ? 'Someone with this name is already on the list.' : !f.role.trim() ? 'Enter the role.' : !(Number(f.basic) >= 1000) ? 'Enter the monthly basic pay.' : f.phone && !/^[6-9]\d{9}$/.test(f.phone) ? 'Mobile must be 10 digits.' : null;
          return (
            <form className="stack" style={{ gap: 12 }} onSubmit={(e) => { e.preventDefault(); if (problem) return; const row = { ...(edit.at != null ? staff[edit.at] : { in: '', status: 'Present' }), name: f.name.trim(), role: f.role.trim(), basic: Math.round(Number(f.basic)), phone: f.phone }; setStaff(edit.at != null ? staff.map((x, j) => (j === edit.at ? row : x)) : [...staff, row]); toast(edit.at != null ? `${row.name} updated.` : `${row.name} added to staff.`); setEdit(null); }}>
              <div className="grid cols-2" style={{ gap: 12 }}>
                <div className="field"><label htmlFor="sf-n">Name</label><input id="sf-n" className="input" value={f.name} onChange={(e) => set('name', e.target.value)} /></div>
                <div className="field"><label htmlFor="sf-r">Role</label><input id="sf-r" className="input" placeholder="Accountant" value={f.role} onChange={(e) => set('role', e.target.value)} /></div>
                <div className="field"><label htmlFor="sf-b">Basic pay (₹ a month)</label><input id="sf-b" type="number" min={1000} step={500} className="input" value={f.basic} onChange={(e) => set('basic', e.target.value)} /></div>
                <div className="field"><label htmlFor="sf-p">Mobile (optional)</label><input id="sf-p" className="input" inputMode="numeric" maxLength={10} value={f.phone} onChange={(e) => set('phone', e.target.value.replace(/\D/g, ''))} /></div>
              </div>
              {problem && (f.name || f.role || f.basic) && <div className="small" style={{ color: 'var(--bad)' }}>{problem}</div>}
              <div className="row"><button className="btn" disabled={!!problem}>{edit.at != null ? 'Save changes' : 'Add staff member'}</button><button type="button" className="btn ghost" onClick={() => setEdit(null)}>Cancel</button></div>
            </form>
          );
        })()}
      </Modal>
      <Modal open={!!rec} onClose={() => setRec(null)} title="Record leave">
        {rec && (
          <form className="stack" style={{ gap: 12 }} onSubmit={(e) => { e.preventDefault(); if (!rec.who || !rec.from || rec.to < rec.from) return; const days = rec.from === rec.to ? formatDate(rec.from) : `${formatDate(rec.from)} to ${formatDate(rec.to)}`; setLeave([{ who: rec.who, days, kind: rec.kind, status: 'Pending' }, ...leave]); setRec(null); toast(`Leave recorded for ${rec.who}. Approve it below.`); }}>
            <div className="field"><label htmlFor="lv-w">Staff member</label><select id="lv-w" className="input" value={rec.who} onChange={(e) => setRec({ ...rec, who: e.target.value })}><option value="">Choose</option>{staff.map((x) => <option key={x.name}>{x.name}</option>)}</select></div>
            <div className="field"><label htmlFor="lv-k">Kind</label><select id="lv-k" className="input" value={rec.kind} onChange={(e) => setRec({ ...rec, kind: e.target.value })}>{['Casual leave', 'Sick leave', 'Earned leave', 'On duty', 'Maternity leave'].map((x) => <option key={x}>{x}</option>)}</select></div>
            <div className="grid cols-2" style={{ gap: 12 }}>
              <div className="field"><label htmlFor="lv-from">From</label><input id="lv-from" type="date" className="input" value={rec.from} onChange={(e) => setRec({ ...rec, from: e.target.value, to: rec.to < e.target.value ? e.target.value : rec.to })} /></div>
              <div className="field"><label htmlFor="lv-to">To</label><input id="lv-to" type="date" className="input" min={rec.from} value={rec.to} onChange={(e) => setRec({ ...rec, to: e.target.value })} /></div>
            </div>
            <div className="row"><button className="btn" disabled={!rec.who || !rec.from || rec.to < rec.from}>Record leave</button><button type="button" className="btn ghost" onClick={() => setRec(null)}>Cancel</button></div>
          </form>
        )}
      </Modal>
      {tab === 'attendance' && <><Stats items={[{ label: 'Present', value: '62 of 66' }, { label: 'On leave', value: 3 }, { label: 'Late', value: 1, tone: 'bad' }]} /><div className="card"><Table head={['Staff', 'Role', 'In', 'Today']} rows={staff.map((s) => [<b key="n">{s.name}</b>, s.role, s.in || '–', <span key="s" className={`pill ${s.status === 'Present' ? 'ok' : s.status === 'Late' ? 'warn' : ''}`}>{s.status}</span>])} /></div></>}
      {tab === 'leave' && <div className="card"><div className="card-head"><h2>Leave</h2><button className="btn sm" onClick={() => setRec({ who: '', kind: 'Casual leave', from: day(1), to: day(1) })}><Icon name="plus" size={16} />Record leave</button></div><Table head={['Staff', 'Leave', 'Dates', '']} rows={leave.map((l, i) => [<b key="n">{l.who}</b>, l.kind, l.days, l.status === 'Pending' ? <div key="a" className="row" style={{ gap: 6 }}><button className="btn sm" onClick={() => void decide(i, 'Approved')}>Approve</button><button className="btn sm ghost" onClick={() => void decide(i, 'Declined')}>Decline</button></div> : <div key="a" className="row" style={{ gap: 6 }}><span className={`pill ${l.status === 'Approved' ? 'ok' : 'bad'}`}>{l.status}</span><button className="btn sm quiet" onClick={() => void decide(i, 'Pending')}>Undo</button></div>])} /></div>}
      {tab === 'payroll' && (
        <div className="card stack">
          <div className="card-head" style={{ margin: 0 }}><h2>Payroll · this month</h2><div className="row">{run && <button className="btn ghost" onClick={() => setBank(true)}><Icon name="download" size={18} />Bank transfer file</button>}<button className="btn" disabled={run} onClick={() => void runPayroll()}>{run ? 'Payroll done ✓' : 'Run payroll'}</button></div></div>
          <Table head={['Staff', 'Basic', 'Allowances', 'PF', 'ESI', 'Net pay', '']} rows={staff.map((s) => { const p = pay(s); return [<b key="n">{s.name}</b>, <span key="b" className="num">{inr(s.basic)}</span>, <span key="a" className="num">{inr(p.al)}</span>, <span key="p" className="num">{inr(p.pf)}</span>, <span key="e" className="num">{p.esi ? inr(p.esi) : '–'}</span>, <b key="t" className="num">{inr(p.net)}</b>, run ? <button key="s" className="btn sm ghost" onClick={() => setSlip(s)}>Payslip</button> : <span key="s" className="dim small">After run</span>]; })} />
          <ExportModal title="Bank transfer file" filename="salary-transfer.csv" head={['Staff', 'Account (last 4)', 'IFSC', 'Net pay (₹)']} rows={staff.map((s, i) => [s.name, `XXXX${4100 + i * 37}`, 'IOBA0001234', pay(s).net])} open={bank} onClose={() => setBank(false)} />
          <PrintModal title={`Payslip · ${slip?.name ?? ''}`} open={!!slip} onClose={() => setSlip(null)}>
            {slip && <Letterhead title={`Payslip · ${slip.name}`}><div className="facts"><div><b>Role</b>{slip.role}</div><div><b>Month</b>{new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</div></div><table><tbody><tr><td>Basic</td><td style={{ textAlign: 'right' }}>{inr(slip.basic)}</td></tr><tr><td>Allowances (DA, HRA)</td><td style={{ textAlign: 'right' }}>{inr(pay(slip).al)}</td></tr><tr><td>PF (12%)</td><td style={{ textAlign: 'right' }}>− {inr(pay(slip).pf)}</td></tr><tr><td>ESI</td><td style={{ textAlign: 'right' }}>{pay(slip).esi ? `− ${inr(pay(slip).esi)}` : '–'}</td></tr><tr style={{ fontWeight: 700 }}><td>Net pay</td><td style={{ textAlign: 'right' }}>{inr(pay(slip).net)}</td></tr></tbody></table><div className="sig"><span>Accountant</span><span>Principal</span></div></Letterhead>}
          </PrintModal>
        </div>
      )}
      {tab === 'appraisal' && <div className="card"><Table head={['Teacher', 'Class results', 'Syllabus on time', 'Parent feedback', 'Overall']} rows={staff.slice(0, 6).map((s, i) => [<b key="n">{s.name}</b>, `${[64, 69, 71, 73, 70, 75][i]}%`, ['Yes', 'Yes', 'Behind 1', 'Yes', 'Yes', 'Yes'][i], `${[4.5, 4.7, 4.2, 4.4, 4.6, 4.8][i]} / 5`, <span key="o" className="pill ok">{['Strong', 'Strong', 'Good', 'Good', 'Strong', 'Outstanding'][i]}</span>])} /></div>}
    </>
  );
}

// ---------------------------------------------------------------- campus: library, hostel, inventory, canteen

type CampusTab = 'overview' | 'library' | 'hostel' | 'inventory' | 'canteen';
const SERVICES: { key: Exclude<CampusTab, 'overview'>; name: string; runBy: string; what: string; steps: string[] }[] = [
  { key: 'library', name: 'Library', runBy: 'Librarian', what: 'Books students borrow and return.', steps: ['Student borrows a book with their ID card', 'Due back in 14 days', 'Parent gets a WhatsApp reminder 2 days before', 'Late books show here until returned'] },
  { key: 'hostel', name: 'Hostel', runBy: 'Wardens', what: 'Students who live on campus: rooms, meals and night roll call.', steps: ['Warden takes night roll call at 9 pm', 'Parents ask for home leave on WhatsApp', 'Warden approves and logs the return date', 'Anyone missing at roll call is shown here'] },
  { key: 'inventory', name: 'Equipment', runBy: 'Store keeper', what: 'School property: smart boards, lab items, computers, buses.', steps: ['Every item is listed with where it is', 'Teachers report damage', 'Store keeper books the repair or service', 'Items needing action show here'] },
  { key: 'canteen', name: 'Canteen wallet', runBy: 'Canteen in-charge', what: 'Cashless snacks: parents top up, children pay with their ID card.', steps: ['Parent tops up by UPI', 'Child pays at the counter with their ID card', 'A daily limit parents set is checked', 'Low balance sends the parent a top-up link'] },
];

/** School services outside the classroom. Each is run by its own staff member; the principal sees how each is doing. */
export function Campus() {
  const roster = useRoster();
  const [tab, setTab] = useState<CampusTab>('overview');
  const loans = roster.slice(0, 6).map((s, i) => ({ id: s.id, name: s.name, cls: s.classLabel, book: pick(['Wings of Fire', 'Ponniyin Selvan, Vol 1', 'Malgudi Days', 'A Brief History of Time', 'Thirukkural (illustrated)', 'Ignited Minds'], i), late: [3, 9, 2, 5, 1, 12][i] }));
  const away = roster.slice(10, 13).map((s, i) => ({ name: s.name, cls: s.classLabel, back: dayLabel(i + 1), reason: ['Family function', 'Fever, with parent', 'Grandmother unwell'][i] }));
  const items = [['Smart boards', 'Classrooms', 24, 'Good', dayLabel(40)], ['Science lab microscopes', 'Biology lab', 30, '2 need repair', dayLabel(12)], ['Computers', 'Computer lab', 48, 'Good', dayLabel(60)], ['Buses', 'Transport', 6, 'Fitness certificate due for 1', dayLabel(9)], ['Water purifiers', 'All blocks', 8, 'Filter change due', dayLabel(3)], ['Chairs and desks', 'All blocks', 1450, 'Good', '–']] as const;
  const needs = items.filter((r) => r[3] !== 'Good');
  const low = roster.slice(20, 26).map((s, i) => ({ name: s.name, cls: s.classLabel, bal: [35, 20, 48, 12, 30, 45][i], parent: s.guardian.name }));
  const card = (k: Exclude<CampusTab, 'overview'>) => SERVICES.find((x) => x.key === k)!;
  const how = (k: Exclude<CampusTab, 'overview'>) => (
    <div className="card stack" style={{ gap: 8 }}>
      <span className="eyebrow">How it works · run by the {card(k).runBy.toLowerCase()}</span>
      <ol className="small" style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 4 }}>{card(k).steps.map((x) => <li key={x}>{x}</li>)}</ol>
    </div>
  );
  return (
    <>
      <PageHead eyebrow="Campus" title="Library, hostel, equipment and canteen" lede="School services outside the classroom. Each one is run day to day by its own staff member. Here you see how each is doing and what needs your attention." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'overview', label: 'Overview' }, ...SERVICES.map((x) => ({ value: x.key, label: x.name }))]} />
      {tab === 'overview' && (
        <div className="grid cols-2">
          {SERVICES.map((x) => {
            const att = x.key === 'library' ? `${loans.length} books overdue` : x.key === 'hostel' ? `${away.length} boarders home on leave` : x.key === 'inventory' ? `${needs.length} items need repair or service` : `${low.length} children low on balance`;
            return (
              <button key={x.key} type="button" className="card stack" style={{ gap: 8, textAlign: 'left', font: 'inherit', color: 'inherit', cursor: 'pointer' }} onClick={() => setTab(x.key)}>
                <div className="row between"><h2>{x.name}</h2><span className="dim small">Run by: {x.runBy}</span></div>
                <span className="muted">{x.what}</span>
                <span className="pill warn" style={{ alignSelf: 'flex-start' }}>{att}</span>
              </button>
            );
          })}
        </div>
      )}
      {tab === 'library' && <>
        <Stats items={[{ label: 'Books in the library', value: '8,412' }, { label: 'Borrowed now', value: 326 }, { label: 'Overdue', value: loans.length, tone: 'bad' }]} />
        <div className="split" style={{ alignItems: 'start' }}>
          <div className="card"><div className="card-head"><h2>Overdue books</h2><span className="dim small">Parents were reminded on WhatsApp</span></div><Table head={['Student', 'Class', 'Book', 'Late by']} rows={loans.map((l) => [<b key="n">{l.name}</b>, l.cls, l.book, <span key="d" className="pill bad">{l.late} day{l.late > 1 ? 's' : ''}</span>])} /></div>
          {how('library')}
        </div>
      </>}
      {tab === 'hostel' && <>
        <Stats items={[{ label: 'Boarders', value: 148 }, { label: 'Beds free', value: 12 }, { label: 'Home on leave', value: away.length }, { label: 'Last night’s roll call', value: `${148 - away.length} of ${148 - away.length}`, tone: 'ok', foot: 'Everyone expected was present' }]} />
        <div className="split" style={{ alignItems: 'start' }}>
          <div className="stack">
            <div className="card"><div className="card-head"><h2>Blocks</h2></div><Table head={['Block', 'Rooms', 'Boarders', 'Warden', 'Today’s menu']} rows={[['Boys A', 24, 78, 'Mr. Daniel', 'Idli, sambar · Rice, kootu · Chapati'], ['Girls B', 22, 70, 'Mrs. Grace', 'Pongal · Rice, rasam · Dosa']].map((r) => r.map((c, i) => (i === 0 ? <b key="b">{c}</b> : c)))} /></div>
            <div className="card"><div className="card-head"><h2>Home on leave</h2></div><Table head={['Student', 'Class', 'Reason', 'Back on']} rows={away.map((a) => [<b key="n">{a.name}</b>, a.cls, a.reason, a.back])} /></div>
          </div>
          {how('hostel')}
        </div>
      </>}
      {tab === 'inventory' && <>
        <Stats items={[{ label: 'Kinds of items', value: items.length }, { label: 'Need repair or service', value: needs.length, tone: needs.length ? 'bad' : undefined }]} />
        <div className="split" style={{ alignItems: 'start' }}>
          <div className="card"><Table head={['Item', 'Where', 'Count', 'Condition', 'Next service']} rows={items.map((r) => [<b key="i">{r[0]}</b>, r[1], r[2], r[3] === 'Good' ? <span key="c" className="pill ok">Good</span> : <span key="c" className="pill warn">{r[3]}</span>, r[4]])} /></div>
          {how('inventory')}
        </div>
      </>}
      {tab === 'canteen' && <>
        <Stats items={[{ label: 'Children using the wallet', value: 612 }, { label: 'Spent today', value: inr(18420) }, { label: 'Low balance', value: low.length, foot: 'Under ₹50' }]} />
        <div className="split" style={{ alignItems: 'start' }}>
          <div className="card"><div className="card-head"><h2>Low balance</h2><span className="dim small">Parents were sent a UPI top-up link</span></div><Table head={['Student', 'Class', 'Balance', 'Parent']} rows={low.map((l) => [<b key="n">{l.name}</b>, l.cls, <span key="b" className="num" style={{ color: 'var(--bad)' }}>{inr(l.bal)}</span>, l.parent])} /></div>
          {how('canteen')}
        </div>
      </>}
    </>
  );
}

// ---------------------------------------------------------------- alumni

type Alum = { id: string; name: string; batch: number; work: string; field: string; mentor: boolean; how: 'Passed out' | 'Signed up' };
type Talk = { id: string; field: string; speaker?: string; date?: string; time?: string; standards: string; replies: string[]; status: 'Inviting' | 'Confirmed' | 'Done' };
const FIELDS = ['Medicine', 'Engineering', 'Commerce', 'Design', 'Law', 'Sports', 'Teaching'];
const PAST: Alum[] = [
  { id: 'al1', name: 'Dr. Vishnu R', batch: 2014, work: 'Doctor, government hospital', field: 'Medicine', mentor: true, how: 'Passed out' },
  { id: 'al2', name: 'Priya Natarajan', batch: 2016, work: 'Software engineer', field: 'Engineering', mentor: true, how: 'Passed out' },
  { id: 'al3', name: 'Aravind K', batch: 2012, work: 'Chartered accountant', field: 'Commerce', mentor: true, how: 'Signed up' },
  { id: 'al4', name: 'Sneha M', batch: 2018, work: 'Designer (NIFT graduate)', field: 'Design', mentor: false, how: 'Passed out' },
  { id: 'al5', name: 'Karthikeyan S', batch: 2015, work: 'State-level kabaddi coach', field: 'Sports', mentor: true, how: 'Passed out' },
  { id: 'al6', name: 'Fathima B', batch: 2019, work: 'Law student (NLU)', field: 'Law', mentor: true, how: 'Signed up' },
  { id: 'al7', name: 'Hari Prasad', batch: 2020, work: 'Mechanical engineer, Coimbatore', field: 'Engineering', mentor: true, how: 'Passed out' },
  { id: 'al8', name: 'Divya Lakshmi', batch: 2017, work: 'Maths teacher', field: 'Teaching', mentor: true, how: 'Passed out' },
];
const TALKS: Talk[] = [
  { id: 'tk1', field: 'Engineering', speaker: 'Priya Natarajan', date: day(-20), time: '14:00', standards: '11 and 12', replies: ['Priya Natarajan', 'Hari Prasad'], status: 'Done' },
  { id: 'tk2', field: 'Medicine', standards: '10, 11 and 12', replies: ['Dr. Vishnu R'], status: 'Inviting' },
];

/**
 * Alumni join automatically when 12th students pass out at year-end promotion, or sign up from the school's link.
 * Mentors: alumni who agreed to mentor are matched to students by the field the student is interested in.
 * Career talks: invite alumni of a field, see who replied YES, confirm one speaker with a date, then mark it done.
 */
export function Alumni() {
  const { toast } = useApp();
  const roster = useRoster();
  const [tab, setTab] = useState<'alumni' | 'mentors' | 'talks'>('alumni');
  const [promoted] = useDemo('promoted', false);
  const [pairs, setPairs] = useDemo<Record<string, string>>('alumni-mentor-pairs', {});
  const [talks, setTalks] = useDemo<Talk[]>('alumni-talks', TALKS);
  const [batch, setBatch] = useState('all');
  const [inviting, setInviting] = useState(false);
  const [inv, setInv] = useState({ field: 'Engineering', standards: '11 and 12' });
  const [confirming, setConfirming] = useState<Talk | null>(null);
  const [cf, setCf] = useState({ speaker: '', date: '', time: '14:00' });
  const passYear = new Date().getMonth() >= 5 ? new Date().getFullYear() + 1 : new Date().getFullYear();
  const twelfth = roster.filter((x) => x.classLabel.startsWith('12-'));
  const fresh: Alum[] = promoted ? twelfth.map((x, i) => ({ id: `new-${x.id}`, name: x.name, batch: passYear, work: 'Just passed out', field: FIELDS[i % 3], mentor: false, how: 'Passed out' })) : [];
  const all = [...fresh, ...PAST];
  const batches = [...new Set(all.map((a) => a.batch))].sort((a, b) => b - a);
  const shown = all.filter((a) => batch === 'all' || String(a.batch) === batch);
  const mentors = all.filter((a) => a.mentor);
  // Students in 10th to 12th who asked for a mentor, with the field they are interested in.
  const askers = roster.filter((x) => /^(10|11|12)-/.test(x.classLabel)).filter((_, i) => i % 4 === 0).slice(0, 8).map((x, i) => ({ id: x.id, name: x.name, cls: x.classLabel, field: FIELDS[(i * 3) % 6] }));
  const load = (m: string) => Object.values(pairs).filter((x) => x === m).length;
  const suggest = (field: string) => mentors.filter((m) => m.field === field).sort((a, b) => load(a.name) - load(b.name))[0] ?? null;
  return (
    <>
      <PageHead eyebrow="Alumni" title="Alumni network" lede="Past students who stay in touch. They mentor students choosing a career and come back to give career talks.">
        {tab === 'talks' && <button className="btn" onClick={() => setInviting(true)}><Icon name="send" size={18} />Invite for a career talk</button>}
      </PageHead>
      <Stats items={[{ label: 'Alumni', value: all.length, foot: `${fresh.length ? `${fresh.length} joined at this year’s pass-out` : 'Sample list'}` }, { label: 'Willing to mentor', value: mentors.length }, { label: 'Students with a mentor', value: Object.keys(pairs).length, foot: `${askers.length - Object.keys(pairs).filter((k) => askers.some((a) => a.id === k)).length} still waiting` }, { label: 'Career talks this year', value: talks.filter((t) => t.status === 'Done').length, foot: `${talks.filter((t) => t.status !== 'Done').length} being arranged` }]} />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'alumni', label: 'Alumni' }, { value: 'mentors', label: 'Mentoring' }, { value: 'talks', label: 'Career talks' }]} />

      {tab === 'alumni' && (
        <div className="split" style={{ alignItems: 'start' }}>
          <div className="card stack" style={{ gap: 10 }}>
            <div className="row"><label htmlFor="al-b" className="small">Batch</label><select id="al-b" className="input" style={{ width: 'auto' }} value={batch} onChange={(e) => setBatch(e.target.value)}><option value="all">All batches</option>{batches.map((b) => <option key={b} value={b}>{b}</option>)}</select></div>
            <Table head={['Name', 'Batch', 'Now', 'Field', 'Mentor', 'Joined by']} rows={shown.map((a) => [<b key="n">{a.name}</b>, a.batch, <span key="w" className="small">{a.work}</span>, a.field, a.mentor ? <span key="m" className="pill ok">Yes</span> : <span key="m" className="dim">–</span>, <span key="h" className="small">{a.how === 'Passed out' ? 'Passing out' : 'Sign-up link'}</span>])} />
          </div>
          <div className="card stack" style={{ gap: 10 }}>
            <h3>How alumni are added</h3>
            <ol className="small" style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 6 }}>
              <li><b>Automatically at pass-out.</b> When the year-end promotion is run in Student records, every 12th student is added here with their batch year. {promoted ? <span className="pill ok">Done for {passYear}: {fresh.length} added</span> : <span className="dim">This year’s {twelfth.length} 12th students join when promotion is run.</span>}</li>
              <li><b>Older batches sign up.</b> Past students who left before the portal fill a short form from the school’s link on WhatsApp or the website.</li>
              <li><b>They keep their details up to date</b>: what they do now, their field, and whether they will mentor.</li>
            </ol>
          </div>
        </div>
      )}

      {tab === 'mentors' && (
        <div className="split" style={{ alignItems: 'start' }}>
          <div className="card stack" style={{ gap: 10 }}>
            <div className="card-head" style={{ margin: 0 }}><h2>Students who asked for a mentor</h2></div>
            <Table head={['Student', 'Class', 'Interested in', 'Mentor', '']} rows={askers.map((st) => {
              const m = pairs[st.id];
              const sug = suggest(st.field);
              return [<b key="n">{st.name}</b>, st.cls, st.field,
                m ? <span key="m" className="pill ok">{m}</span> : sug ? <span key="m" className="small">Suggested: {sug.name}</span> : <span key="m" className="pill warn">No {st.field.toLowerCase()} mentor yet</span>,
                m ? <button key="a" className="btn sm quiet" onClick={() => { const n = { ...pairs }; delete n[st.id]; setPairs(n); toast(`Mentoring for ${st.name} ended.`); }}>End</button>
                  : sug ? <button key="a" className="btn sm ghost" aria-label={`Assign ${sug.name} to ${st.name}`} onClick={() => { setPairs({ ...pairs, [st.id]: sug.name }); toast(`${sug.name} now mentors ${st.name}. Both got a WhatsApp introduction, and the parent was told.`); }}>Assign</button> : <span key="a" />];
            })} />
          </div>
          <div className="card stack" style={{ gap: 10 }}>
            <h3>How mentors are assigned</h3>
            <ol className="small" style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 6 }}>
              <li>A 10th to 12th student asks for a mentor from Career guidance, and picks the field they are interested in.</li>
              <li>The portal suggests an alumnus from that field who agreed to mentor and has the fewest students.</li>
              <li><b>Assign</b> sends both an introduction on WhatsApp and tells the parent. One mentor has at most three students.</li>
              <li><b>End</b> closes it when the student has chosen their course.</li>
            </ol>
          </div>
        </div>
      )}

      {tab === 'talks' && (
        <div className="split" style={{ alignItems: 'start' }}>
          <div className="stack">
            {talks.map((t) => (
              <div key={t.id} className="card stack" style={{ gap: 8 }}>
                <div className="row between"><h3>{t.field} career talk</h3><span className={`pill ${t.status === 'Done' ? 'ok' : t.status === 'Confirmed' ? 'accent' : 'warn'}`}>{t.status === 'Inviting' ? 'Waiting for replies' : t.status}</span></div>
                <span className="small muted">For standards {t.standards}{t.speaker ? ` · Speaker: ${t.speaker}` : ''}{t.date ? ` · ${formatDate(t.date)}, ${t.time}` : ''}</span>
                <span className="small">Replied YES: {t.replies.length ? t.replies.join(', ') : 'nobody yet'}</span>
                {t.status === 'Inviting' && <button className="btn sm" style={{ alignSelf: 'flex-start' }} disabled={!t.replies.length} onClick={() => { setCf({ speaker: t.replies[0], date: '', time: '14:00' }); setConfirming(t); }}>Confirm a speaker and date</button>}
                {t.status === 'Confirmed' && <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => { setTalks(talks.map((x) => (x.id === t.id ? { ...x, status: 'Done' } : x))); toast('Marked done. A thank-you note went to the speaker.'); }}>Mark as done</button>}
              </div>
            ))}
          </div>
          <div className="card stack" style={{ gap: 10 }}>
            <h3>How a career talk is finalised</h3>
            <ol className="small" style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 6 }}>
              <li><b>Invite</b> alumni of one field, and say which standards the talk is for.</li>
              <li>Alumni reply YES on WhatsApp; their names appear on the talk.</li>
              <li><b>Confirm</b> one speaker with a date and time. The speaker gets the details, and students and parents of those standards are told.</li>
              <li>After the talk, <b>mark it done</b>. A thank-you goes to the speaker.</li>
            </ol>
          </div>
        </div>
      )}

      <Modal open={inviting} onClose={() => setInviting(false)} title="Invite alumni for a career talk">
        <form className="stack" style={{ gap: 12 }} onSubmit={(e) => { e.preventDefault(); const n = all.filter((a) => a.field === inv.field).length; setTalks([{ id: `tk${Date.now()}`, field: inv.field, standards: inv.standards, replies: [], status: 'Inviting' }, ...talks]); setInviting(false); toast(`Invitation sent to ${n} ${inv.field.toLowerCase()} alumni on WhatsApp. Replies appear on the talk.`); }}>
          <div className="grid cols-2" style={{ gap: 12 }}>
            <div className="field"><label htmlFor="ct-f">Field</label><select id="ct-f" className="input" value={inv.field} onChange={(e) => setInv({ ...inv, field: e.target.value })}>{FIELDS.map((f) => <option key={f}>{f}</option>)}</select></div>
            <div className="field"><label htmlFor="ct-s">For standards</label><select id="ct-s" className="input" value={inv.standards} onChange={(e) => setInv({ ...inv, standards: e.target.value })}>{['9 and 10', '11 and 12', '10, 11 and 12'].map((x) => <option key={x}>{x}</option>)}</select></div>
          </div>
          <p className="dim small">Goes to {all.filter((a) => a.field === inv.field).length} alumni in {inv.field.toLowerCase()} who agreed to hear from the school.</p>
          <div className="row"><button className="btn">Send invitation</button><button type="button" className="btn ghost" onClick={() => setInviting(false)}>Cancel</button></div>
        </form>
      </Modal>
      <Modal open={!!confirming} onClose={() => setConfirming(null)} title={confirming ? `Confirm the ${confirming.field.toLowerCase()} talk` : ''}>
        {confirming && (
          <form className="stack" style={{ gap: 12 }} onSubmit={(e) => { e.preventDefault(); if (!cf.date) return; setTalks(talks.map((x) => (x.id === confirming.id ? { ...x, speaker: cf.speaker, date: cf.date, time: cf.time, status: 'Confirmed' } : x))); setConfirming(null); toast(`${cf.speaker} confirmed for ${formatDate(cf.date)}. Students and parents of standards ${confirming.standards} were told.`); }}>
            <div className="field"><label htmlFor="cc-s">Speaker</label><select id="cc-s" className="input" value={cf.speaker} onChange={(e) => setCf({ ...cf, speaker: e.target.value })}>{confirming.replies.map((r) => <option key={r}>{r}</option>)}</select></div>
            <div className="grid cols-2" style={{ gap: 12 }}>
              <div className="field"><label htmlFor="cc-d">Date</label><input id="cc-d" type="date" className="input" min={day(1)} required value={cf.date} onChange={(e) => setCf({ ...cf, date: e.target.value })} /></div>
              <div className="field"><label htmlFor="cc-t">Time</label><input id="cc-t" type="time" className="input" value={cf.time} onChange={(e) => setCf({ ...cf, time: e.target.value })} /></div>
            </div>
            <div className="row"><button className="btn" disabled={!cf.date}>Confirm talk</button><button type="button" className="btn ghost" onClick={() => setConfirming(null)}>Cancel</button></div>
          </form>
        )}
      </Modal>
    </>
  );
}

// ---------------------------------------------------------------- multi-branch view

export function Branches() {
  const rows = [
    { name: 'Main campus', board: 'Matriculation', students: 1212, att: 93, avg: 66, fees: 82, pass: 97, centum: 11 },
    { name: 'CBSE wing', board: 'CBSE', students: 864, att: 91, avg: 71, fees: 88, pass: 99, centum: 6 },
    { name: 'Junior campus', board: 'Matriculation', students: 640, att: 95, avg: 74, fees: 79, pass: 0, centum: 0 },
  ];
  return (
    <>
      <PageHead eyebrow="School group" title="All branches" lede="For correspondents running more than one school: every branch on one screen, with the same measures." />
      <Stats items={[{ label: 'Students', value: '2,716' }, { label: 'Attendance today', value: <>93<small>%</small></> }, { label: 'Fees collected', value: <>83<small>%</small></> }, { label: 'Board centums (2026)', value: 17 }]} />
      <div className="card"><Table head={['Branch', 'Board', 'Students', 'Attendance', 'Average marks', 'Fees collected', '10th pass', 'Centums']} rows={rows.map((r) => [<b key="n">{r.name}</b>, r.board, r.students.toLocaleString('en-IN'), `${r.att}%`, `${r.avg}%`, `${r.fees}%`, r.pass ? `${r.pass}%` : '–', r.centum || '–'])} /></div>
    </>
  );
}

// ---------------------------------------------------------------- compliance, privacy and backups

export function Compliance() {
  const { api, toast } = useApp();
  const [tab, setTab] = useState<'exports' | 'privacy' | 'backups' | 'audit'>('exports');
  const audit = useLoad(() => api.listAudit(), []);
  const [consent, setConsent] = useDemo('consent-settings', { whatsapp: true, photos: true, ai: true });
  const [ran, setRan] = useDemo<string[]>('exports-run', []);
  const [exp, setExp] = useState<string | null>(null);
  const all = useRoster();
  const [std, setStd] = useState('all');
  const [cls, setCls] = useState('all');
  const gradeOfLabel = (l: string) => l.split('-')[0];
  const grades = [...new Set(all.map((s) => gradeOfLabel(s.classLabel)))].sort((a, b) => Number(a) - Number(b));
  const sections = [...new Set(all.filter((s) => std === 'all' || gradeOfLabel(s.classLabel) === std).map((s) => s.classLabel))].sort();
  const roster = all.filter((s) => (std === 'all' || gradeOfLabel(s.classLabel) === std) && (cls === 'all' || s.classLabel === cls));
  const scope = cls !== 'all' ? cls : std !== 'all' ? `std-${std}` : '';
  const named = (f: string) => (scope ? f.replace('.csv', `-${scope.toLowerCase()}.csv`) : f);
  const schoolWide = ['UDISE+ school profile', 'Teacher details'];
  const files: Record<string, { file: string; head: string[]; rows: (string | number)[][] }> = {
    'EMIS student details': { file: 'emis-students.csv', head: ['EMIS no.', 'Name', 'Gender', 'Date of birth', 'Class', 'Parent mobile'], rows: roster.map((s) => [s.emis, s.name, s.gender, s.dob, s.classLabel, s.guardian.phone]) },
    'UDISE+ school profile': { file: 'udise-profile.csv', head: ['Field', 'Value'], rows: [['School name', 'From settings'], ['Board', 'Matriculation'], ['Students', all.length], ['Teachers', 66], ['Classrooms', 24], ['Toilets (girls/boys)', '12 / 12'], ['Drinking water', 'Yes'], ['Computer lab', 'Yes']] },
    'SSLC board registration (nominal roll)': { file: 'sslc-nominal-roll.csv', head: ['Reg. no.', 'Name', 'Date of birth', 'Medium', 'Language'], rows: roster.filter((s) => s.classLabel.startsWith('10')).map((s) => [`2026${s.classLabel.replace('-', '')}${String(s.rollNo).padStart(2, '0')}`, s.name, s.dob, 'English', 'Tamil']) },
    'HSC board registration (nominal roll)': { file: 'hsc-nominal-roll.csv', head: ['Reg. no.', 'Name', 'Date of birth', 'Group', 'Language'], rows: roster.filter((s) => s.classLabel.startsWith('12')).map((s) => [`2026${s.classLabel.replace('-', '')}${String(s.rollNo).padStart(2, '0')}`, s.name, s.dob, 'Biology–Maths', 'Tamil']) },
    'Scholarship list (BC/MBC post-matric)': { file: 'scholarship-list.csv', head: ['Name', 'Class', 'Community', 'Family income (₹)'], rows: roster.filter((_, i) => i % 4 === 0).map((s, i) => [s.name, s.classLabel, pick(['BC', 'MBC'], i), pick([180000, 210000, 120000], i)]) },
    'Teacher details': { file: 'emis-staff.csv', head: ['Name', 'Subject', 'Qualification'], rows: [['Mr. K. Karthik', 'Maths', 'M.Sc., B.Ed.'], ['Mrs. R. Lakshmi', 'Science', 'M.Sc., B.Ed.'], ['Mr. P. Rajan', 'Social Science', 'M.A., B.Ed.'], ['Mrs. V. Revathi', 'English', 'M.A., B.Ed.']] },
  };
  const cur = exp ? files[exp] : null;
  return (
    <>
      <PageHead eyebrow="Compliance and trust" title="Government exports, privacy and backups" lede="EMIS and UDISE+ ready exports, board registration and scholarship lists, DPDP consent records, parents’ data rights, daily backups and a full audit log." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'exports', label: 'Government exports' }, { value: 'privacy', label: 'Privacy and consent' }, { value: 'backups', label: 'Backups' }, { value: 'audit', label: 'Audit log' }]} />
      {tab === 'exports' && <div className="card"><div className="card-head"><div className="row">
        <label className="sr" htmlFor="cx-g">Standard</label><select id="cx-g" className="input" style={{ width: 'auto' }} value={std} onChange={(e) => { setStd(e.target.value); setCls('all'); }}><option value="all">All standards</option>{grades.map((g) => <option key={g} value={g}>Standard {g}</option>)}</select>
        <label className="sr" htmlFor="cx-c">Class</label><select id="cx-c" className="input" style={{ width: 'auto' }} value={cls} onChange={(e) => setCls(e.target.value)}><option value="all">All classes</option>{sections.map((c) => <option key={c} value={c}>{c}</option>)}</select>
      </div><span className="dim small">{std === 'all' && cls === 'all' ? `Whole school, ${all.length} students` : `${roster.length} students in ${cls !== 'all' ? cls : `standard ${std}`}`}. The school profile and teacher details are always school-wide.</span></div><Table head={['Export', 'Format', 'Rows', 'Last run', '']} rows={[['EMIS student details', 'EMIS bulk upload', dayLabel(-14)], ['UDISE+ school profile', 'UDISE+ DCF', dayLabel(-60)], ['SSLC board registration (nominal roll)', 'DGE format', dayLabel(-30)], ['HSC board registration (nominal roll)', 'DGE format', dayLabel(-30)], ['Scholarship list (BC/MBC post-matric)', 'State portal', dayLabel(-45)], ['Teacher details', 'EMIS staff', dayLabel(-14)]].map((r) => [<b key="e">{r[0]}</b>, <span key="f" className="small">{r[1]}</span>, <span key="n">{files[r[0]].rows.length}{schoolWide.includes(r[0]) ? <span className="dim small"> · school-wide</span> : null}</span>, ran.includes(r[0]) ? <span key="l" className="pill ok">Today</span> : r[2], <button key="d" className="btn sm ghost" disabled={files[r[0]].rows.length === 0} aria-label={`Export ${r[0]}`} onClick={() => { setExp(r[0]); if (!ran.includes(r[0])) setRan([...ran, r[0]]); }}><Icon name="download" size={16} />Export</button>])} /></div>}
      {cur && <ExportModal title={exp!} filename={exp && schoolWide.includes(exp) ? cur.file : named(cur.file)} head={cur.head} rows={cur.rows} open onClose={() => setExp(null)} />}
      {tab === 'privacy' && (
        <div className="grid cols-2">
          <div className="card stack" style={{ gap: 12 }}>
            <h3>What parents consent to</h3>
            {([['whatsapp', 'WhatsApp updates'], ['photos', 'Child in event photos'], ['ai', 'AI correction of answer scripts']] as const).map(([k, l]) => <div key={k} className="row between"><span>{l}</span><Switch checked={consent[k]} label={l} onChange={(v) => setConsent({ ...consent, [k]: v })} /></div>)}
            <span className="dim small">1,164 of 1,180 parents have recorded consent. Each record keeps the time and the version of the notice.</span>
          </div>
          <div className="card stack"><h3>Parents’ data rights</h3><p className="muted small">From the parent page, a parent can view everything held about their child, correct it, download it, or ask for it to be deleted. Requests land in Requests with a 7-day deadline.</p><div className="list"><div className="row between"><span>Download requests this year</span><b>12</b></div><div className="row between"><span>Corrections</span><b>31</b></div><div className="row between"><span>Deletions (left school)</span><b>4</b></div></div><span className="dim small">All data is stored in India. Each school’s data is walled off from every other school.</span></div>
        </div>
      )}
      {tab === 'backups' && <div className="card"><Table head={['Backup', 'Size', 'Where', 'Status']} rows={[0, 1, 2, 3, 4].map((d) => [dayLabel(-d) + ', 2:00 am', `${(412 - d * 0.6).toFixed(1)} MB`, 'India region, encrypted', <span key="s" className="pill ok">Verified</span>])} /><p className="dim small" style={{ marginTop: 12 }}>Kept for 35 days. If a school leaves, its full data is handed back as Excel and PDF within 7 days.</p></div>}
      {tab === 'audit' && (audit.data ? <div className="card"><Table head={['When', 'Who', 'What']} rows={audit.data.slice(0, 30).map((a) => [<span key="w" className="small">{relTime(a.at)}</span>, a.actor, <span key="d"><b>{a.action}</b> <span className="muted small">{a.detail}</span></span>])} /></div> : <Loading />)}
    </>
  );
}

export { Seg };
