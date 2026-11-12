import { createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { OutboundMessage, Portal } from '@enticra/core';

/**
 * Live WhatsApp for pitch demos, through Meta's WhatsApp Cloud API.
 *
 * The sample parents have made-up numbers, so nothing is ever sent to them. Instead the principal
 * registers a few real phones (their own, the client's) and links each to one sample parent. Messages
 * for that parent go to the real phone; every other message stays simulated.
 */
export interface WhatsAppConfig {
  token: string;
  phoneNumberId: string;
  appSecret: string;
  verifyToken: string;
  /** An approved template with one body variable. Without it, plain text is sent, which WhatsApp allows
   *  only within 24 hours of the phone last messaging the business number. */
  template?: string;
  templateLang?: string;
  apiBase?: string;
}

export interface Route { samplePhone: string; realPhone: string; lastInbound?: string }
export interface RouteView { samplePhone: string; guardianName: string; studentName: string; phoneEnding: string; windowOpenUntil: string | null }

export function whatsAppConfigFromEnv(env: NodeJS.ProcessEnv): WhatsAppConfig | null {
  const { WHATSAPP_TOKEN: token, WHATSAPP_PHONE_NUMBER_ID: phoneNumberId, WHATSAPP_APP_SECRET: appSecret, WHATSAPP_VERIFY_TOKEN: verifyToken } = env;
  if (!token || !phoneNumberId || !appSecret || !verifyToken) return null;
  return { token, phoneNumberId, appSecret, verifyToken, template: env.WHATSAPP_TEMPLATE || undefined, templateLang: env.WHATSAPP_TEMPLATE_LANG || 'en', apiBase: env.WHATSAPP_API_BASE };
}

/** Digits with country code, as WhatsApp wants them. A bare 10-digit number is taken as Indian. */
export function normalisePhone(raw: string): string | null {
  const d = String(raw ?? '').replace(/\D/g, '');
  if (d.length === 10) return `91${d}`;
  return d.length >= 11 && d.length <= 15 ? d : null;
}

// Meta error codes worth explaining to a presenter.
const REASONS: Record<number, string> = {
  131047: 'More than 24 hours since this phone messaged the school number. Send “Hi” from the phone, then try again.',
  131026: 'This phone could not receive the message. Check it has WhatsApp and is added as a test number in Meta.',
  131030: 'This phone is not on the allowed list for the test number. Add it in Meta under API Setup.',
  131056: 'Too many messages to this phone in a short time. Wait a minute.',
  132001: 'The message template is not approved yet, or its name or language is wrong.',
  190: 'The WhatsApp access token has expired. Create a new one in Meta and restart the server.',
};
const reason = (e: { code?: number; title?: string; message?: string; error_data?: { details?: string } } | undefined) =>
  (e?.code && REASONS[e.code]) || e?.error_data?.details || e?.message || e?.title || 'WhatsApp refused the message.';

export class WhatsAppLive {
  private routes: Route[] = [];
  private readonly api: string;

  constructor(private cfg: WhatsAppConfig, private portal: Portal, private file?: string, private fetchFn: typeof fetch = fetch) {
    this.api = `${(cfg.apiBase ?? 'https://graph.facebook.com/v21.0').replace(/\/$/, '')}/${cfg.phoneNumberId}/messages`;
    if (file && existsSync(file)) { try { this.routes = JSON.parse(readFileSync(file, 'utf8')); } catch { this.routes = []; } }
  }

  private persist() { if (this.file) writeFileSync(this.file, JSON.stringify(this.routes, null, 2)); }

  get mode() { return this.cfg.template ? `template “${this.cfg.template}”` : 'text'; }

  /** Routes for one school, without the real numbers: only the last four digits are ever shown. */
  listRoutes(schoolId: string): RouteView[] {
    return this.routes.flatMap((r) => {
      const st = this.portal.db.students.find((s) => s.schoolId === schoolId && s.guardian.phone === r.samplePhone);
      if (!st) return [];
      const until = r.lastInbound ? new Date(new Date(r.lastInbound).getTime() + 24 * 3600e3) : null;
      return [{ samplePhone: r.samplePhone, guardianName: st.guardian.name, studentName: st.name, phoneEnding: r.realPhone.slice(-4), windowOpenUntil: until && until > new Date() ? until.toISOString() : null }];
    });
  }

  setRoute(schoolId: string, samplePhone: string, realPhone: string) {
    if (!this.portal.db.students.some((s) => s.schoolId === schoolId && s.guardian.phone === samplePhone && s.consent.whatsapp)) throw new Error('Choose a parent from this school who has agreed to WhatsApp messages.');
    const real = normalisePhone(realPhone);
    if (!real) throw new Error('Enter the phone number with country code, for example 91 98765 43210.');
    if (this.routes.filter((r) => r.samplePhone !== samplePhone).length >= 5) throw new Error('Meta’s test number allows 5 phones. Remove one first.');
    this.routes = [...this.routes.filter((r) => r.samplePhone !== samplePhone), { samplePhone, realPhone: real }];
    this.persist();
  }

  removeRoute(schoolId: string, samplePhone: string) {
    const ours = new Set(this.listRoutes(schoolId).map((r) => r.samplePhone));
    this.routes = this.routes.filter((r) => !(r.samplePhone === samplePhone && ours.has(samplePhone)));
    this.persist();
  }

  /** Called for every message the portal sends. Only routed parents get a real message. */
  async handle(msg: OutboundMessage) {
    const route = this.routes.find((r) => r.samplePhone === msg.to);
    if (!route) return;
    const payload = this.cfg.template
      ? { type: 'template', template: { name: this.cfg.template, language: { code: this.cfg.templateLang }, components: [{ type: 'body', parameters: [{ type: 'text', text: msg.body.replace(/\s*\n+\s*/g, ' ') }] }] } }
      : { type: 'text', text: { preview_url: false, body: msg.body } };
    try {
      const res = await this.fetchFn(this.api, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.cfg.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: route.realPhone, ...payload }),
      });
      const data = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: Parameters<typeof reason>[0] };
      const id = data.messages?.[0]?.id;
      if (res.ok && id) this.portal.messageAccepted(msg.id, id);
      else this.portal.messageFailed(msg.id, reason(data.error));
    } catch {
      this.portal.messageFailed(msg.id, 'Could not reach WhatsApp. Check the server’s internet connection.');
    }
  }

  /** A one-off hello to a registered phone, to check the setup before a pitch. Not recorded as a parent message. */
  async sendTest(schoolId: string, samplePhone: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const view = this.listRoutes(schoolId).find((r) => r.samplePhone === samplePhone);
    const route = this.routes.find((r) => r.samplePhone === samplePhone);
    if (!view || !route) return { ok: false, error: 'That phone is not registered.' };
    const payload = this.cfg.template
      ? { type: 'template', template: { name: this.cfg.template, language: { code: this.cfg.templateLang }, components: [{ type: 'body', parameters: [{ type: 'text', text: `Test from Enticra School. Messages for ${view.guardianName} will arrive on this phone during the demo.` }] }] } }
      : { type: 'text', text: { body: `Test from Enticra School. Messages for ${view.guardianName} (${view.studentName}) will arrive on this phone during the demo.` } };
    try {
      const res = await this.fetchFn(this.api, { method: 'POST', headers: { authorization: `Bearer ${this.cfg.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', to: route.realPhone, ...payload }) });
      const data = (await res.json().catch(() => ({}))) as { error?: Parameters<typeof reason>[0] };
      return res.ok ? { ok: true } : { ok: false, error: reason(data.error) };
    } catch { return { ok: false, error: 'Could not reach WhatsApp.' }; }
  }

  /** Meta's one-time check when the webhook URL is saved. */
  verify(query: Record<string, unknown>): string | null {
    return query['hub.mode'] === 'subscribe' && query['hub.verify_token'] === this.cfg.verifyToken ? String(query['hub.challenge'] ?? '') : null;
  }

  /** Meta signs every webhook call with the app secret; anything unsigned is ignored. */
  signed(raw: Buffer | undefined, header: string | undefined): boolean {
    if (!raw || !header?.startsWith('sha256=')) return false;
    const want = Buffer.from(createHmac('sha256', this.cfg.appSecret).update(raw).digest('hex'));
    const got = Buffer.from(header.slice(7));
    return want.length === got.length && timingSafeEqual(want, got);
  }

  /** Delivery ticks and incoming messages from WhatsApp. */
  receive(body: unknown) {
    type Value = { statuses?: { id: string; status: string; errors?: Parameters<typeof reason>[0][] }[]; messages?: { from: string }[] };
    const entries = (body as { entry?: { changes?: { value?: Value }[] }[] })?.entry ?? [];
    let touched = false;
    for (const v of entries.flatMap((e) => e.changes ?? []).map((c) => c.value ?? {})) {
      for (const s of v.statuses ?? []) {
        if (s.status === 'sent' || s.status === 'delivered' || s.status === 'read' || s.status === 'failed') this.portal.messageStatus(s.id, s.status, s.status === 'failed' ? reason(s.errors?.[0]) : undefined);
      }
      for (const m of v.messages ?? []) {
        // A message from a registered phone opens WhatsApp's 24-hour window for plain-text replies.
        const r = this.routes.find((x) => x.realPhone === m.from);
        if (r) { r.lastInbound = new Date().toISOString(); touched = true; }
      }
    }
    if (touched) this.persist();
  }
}
