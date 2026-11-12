import { useEffect, useState } from 'react';
import { TEMPLATE_LABELS, type NotifyKey, type OutboundMessage } from '@enticra/core';
import { DEMO, liveWhatsApp, type LiveView } from '../api';
import { Crest, Icon, Loading, Modal, PageHead, Seg, relTime, useApp, useConfirm, useLoad } from '../ui';

const STATUS: Record<OutboundMessage['status'], { label: string; cls: string }> = {
  sent: { label: 'Sent ✓', cls: '' }, delivered: { label: 'Delivered ✓✓', cls: '' }, read: { label: 'Read ✓✓', cls: 'ok' },
  scheduled: { label: 'Held for quiet hours', cls: 'warn' }, skipped_no_consent: { label: 'No consent, not sent', cls: 'bad' }, failed: { label: 'Failed', cls: 'bad' },
};

export function WaBubble({ m, meta }: { m: OutboundMessage; meta?: string }) {
  const s = STATUS[m.status];
  return (
    <div className="bubble" lang={m.lang}>
      {m.body}
      <div className="meta"><span>{meta ?? relTime(m.createdAt)}</span><span style={{ color: s.cls === 'ok' ? '#34B7F1' : s.cls ? `var(--${s.cls})` : undefined }}>{s.label}</span></div>
    </div>
  );
}

export function Messages() {
  const { api, session } = useApp();
  const [filter, setFilter] = useState<'all' | NotifyKey>('all');
  const { data, reload } = useLoad(() => api.listMessages({ limit: 300 }), []);
  const school = session.school!;
  // While real WhatsApp messages are on their way, refresh so the ticks change as the phone receives and reads them.
  const waiting = !!data?.some((m) => m.live && (m.status === 'sent' || m.status === 'delivered'));
  useEffect(() => { if (!waiting) return; const t = window.setInterval(reload, 3000); return () => window.clearInterval(t); }, [waiting, reload]);
  if (!data) return <Loading />;
  const isParent = session.user.role === 'parent';
  const list = data.filter((m) => filter === 'all' || m.template === filter);
  const counts = { total: data.length, read: data.filter((m) => m.status === 'read').length, held: data.filter((m) => m.status === 'scheduled').length, skipped: data.filter((m) => m.status === 'skipped_no_consent').length };

  if (isParent) {
    return (
      <>
        <PageHead title="WhatsApp updates" lede={`Everything ${school.shortName} has sent to +91 ${session.user.phone}. No app to install; this is the same as your WhatsApp chat.`} />
        <div className="wa" style={{ maxWidth: 640 }}>
          <div className="wa-head"><Crest school={school} /><div><b>{school.shortName}</b><div className="dim small">Verified school account</div></div></div>
          {[...data].reverse().map((m) => <WaBubble key={m.id} m={m} />)}
        </div>
      </>
    );
  }

  return (
    <>
      <PageHead title="Parent messages" lede="Every WhatsApp update the portal sent, with delivery status. Parents get one clear message, not group-chat noise." />
      <div className="grid cols-4">
        <div className="card stat"><span className="eyebrow">Messages</span><span className="value">{counts.total}</span></div>
        <div className="card stat"><span className="eyebrow">Read by parents</span><span className="value">{counts.total ? Math.round((counts.read / counts.total) * 100) : 0}<small>%</small></span></div>
        <div className="card stat"><span className="eyebrow">Held for quiet hours</span><span className="value">{counts.held}</span><span className="foot">Sent at {school.settings.quietHours.end}</span></div>
        <div className="card stat"><span className="eyebrow">No consent</span><span className="value">{counts.skipped}</span><span className="foot">Not sent until a parent opts in</span></div>
      </div>
      {!DEMO && session.user.role === 'principal' && <LiveWhatsApp />}
      <div className="card">
        <div className="card-head">
          <Seg label="Filter by type" value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, ...(Object.keys(TEMPLATE_LABELS) as NotifyKey[]).map((k) => ({ value: k, label: TEMPLATE_LABELS[k] }))]} />
          <span className="dim small">{list.length} shown · {list.some((m) => m.live) ? '“Live” rows went to a real phone; the rest are simulated' : 'WhatsApp sending is simulated except for phones linked under Live WhatsApp'}</span>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>When</th><th>Parent</th><th>Type</th><th>Message</th><th>Status</th></tr></thead>
            <tbody>
              {list.slice(0, 120).map((m) => (
                <tr key={m.id}>
                  <td className="small dim" style={{ whiteSpace: 'nowrap' }}>{relTime(m.createdAt)}</td>
                  <td><b>{m.guardianName}</b><div className="dim small">{m.studentName} · +91 {m.to}</div></td>
                  <td><span className="pill">{TEMPLATE_LABELS[m.template]}</span> {m.lang === 'ta' && <span className="pill">தமிழ்</span>}</td>
                  <td style={{ minWidth: 260 }} lang={m.lang}>{m.body}</td>
                  <td>
                    <span className={`pill ${STATUS[m.status].cls}`}>{STATUS[m.status].label}</span>{m.live && <span className="pill accent" style={{ marginLeft: 6 }}>Live</span>}
                    {m.error && <div className="small" style={{ color: 'var(--bad)', marginTop: 4, maxWidth: 260 }}>{m.error}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/** Link sample parents to real phones so a client sees messages arrive during a pitch. */
function LiveWhatsApp() {
  const { session, toast } = useApp();
  const wa = liveWhatsApp(session.token);
  const [view, setView] = useState<LiveView | null>(null);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ samplePhone: '', realPhone: '', ok: false });
  const [busy, setBusy] = useState('');
  const [ask, confirmEl] = useConfirm();
  useEffect(() => { wa.view().then(setView, () => setView(null)); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!view) return null;
  const act = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key);
    try { await fn(); toast(done); } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(''); }
  };
  const save = () => act('save', async () => { setView(await wa.set(f.samplePhone, f.realPhone)); setOpen(false); }, 'Phone linked. Send a test to check it.');
  const remove = async (r: LiveView['routes'][number]) => {
    if (!(await ask({ title: 'Unlink this phone?', body: `Messages for ${r.guardianName} go back to being simulated. The phone ending ${r.phoneEnding} gets nothing more.`, confirm: 'Unlink', danger: true }))) return;
    await act(r.samplePhone, async () => setView(await wa.remove(r.samplePhone)), 'Phone unlinked.');
  };
  const free = view.parents.filter((p) => !view.routes.some((r) => r.samplePhone === p.samplePhone));
  return (
    <div className="card stack" style={{ gap: 12 }}>
      {confirmEl}
      <div className="card-head" style={{ margin: 0 }}>
        <div><h2>Live WhatsApp</h2><span className="dim small">For demos: real messages to phones you choose. Sample parents’ numbers are never messaged.</span></div>
        {view.enabled ? <button className="btn ghost" disabled={view.routes.length >= 5} onClick={() => { setF({ samplePhone: free[0]?.samplePhone ?? '', realPhone: '', ok: false }); setOpen(true); }}><Icon name="plus" size={18} />Link a phone</button> : <span className="pill">Not set up on this server</span>}
      </div>
      {!view.enabled && <p className="muted small">Add the WhatsApp settings to the server (see the setup guide) and restart it. Until then every message is simulated.</p>}
      {view.enabled && (view.routes.length === 0 ? <p className="muted small">No phones linked. Link your phone to a sample parent, then mark that parent’s child absent or post homework and watch it arrive.</p> : (
        <div className="list">
          {view.routes.map((r) => (
            <div key={r.samplePhone} className="row between">
              <span><b>{r.guardianName}</b> <span className="dim small">({r.studentName})</span> → phone ending <b className="num">{r.phoneEnding}</b>
                <div className="dim small">{view.mode === 'text' ? (r.windowOpenUntil ? `Ready: this phone messaged the school number, open until ${new Date(r.windowOpenUntil).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}` : 'Send “Hi” from this phone to the WhatsApp test number first, so WhatsApp lets the school reply.') : `Sent with ${view.mode}`}</div>
              </span>
              <span className="row" style={{ gap: 6 }}>
                <button className="btn sm ghost" disabled={busy === `t${r.samplePhone}`} onClick={() => void act(`t${r.samplePhone}`, () => wa.test(r.samplePhone), `Test sent to the phone ending ${r.phoneEnding}.`)}>Send a test</button>
                <button className="btn sm quiet" disabled={busy === r.samplePhone} onClick={() => void remove(r)}>Unlink</button>
              </span>
            </div>
          ))}
        </div>
      ))}
      <Modal open={open} onClose={() => setOpen(false)} title="Link a real phone">
        <form className="stack" style={{ gap: 12 }} onSubmit={(e) => { e.preventDefault(); if (f.ok) void save(); }}>
          <div className="field"><label htmlFor="lw-p">Messages meant for this sample parent</label><select id="lw-p" className="input" required value={f.samplePhone} onChange={(e) => setF({ ...f, samplePhone: e.target.value })}>{free.map((p) => <option key={p.samplePhone} value={p.samplePhone}>{p.guardianName} · parent of {p.studentName}</option>)}</select></div>
          <div className="field"><label htmlFor="lw-r">go to this WhatsApp number</label><input id="lw-r" className="input" inputMode="tel" required placeholder="91 98765 43210" value={f.realPhone} onChange={(e) => setF({ ...f, realPhone: e.target.value })} /><span className="dim small">With country code. It must also be added as a recipient in Meta. Only the last 4 digits are shown after saving.</span></div>
          <label className="row" style={{ gap: 8, alignItems: 'flex-start', flexWrap: 'nowrap' }}><input type="checkbox" checked={f.ok} onChange={(e) => setF({ ...f, ok: e.target.checked })} /><span className="small">The owner of this phone has agreed to receive demo messages from the school.</span></label>
          <div className="row"><button className="btn" disabled={!f.ok || !f.realPhone.trim() || busy === 'save'}>Link phone</button><button type="button" className="btn ghost" onClick={() => setOpen(false)}>Cancel</button></div>
        </form>
      </Modal>
    </div>
  );
}
