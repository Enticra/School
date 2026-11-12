import express, { type NextFunction, type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Portal, PortalError, RPC_METHODS, type Db, type Grader, type OutboundMessage, type ScriptPage, type User } from '@enticra/core';
import { PageError, preparePages } from './pages';
import { OtpAuth } from './auth';
import { WhatsAppLive, type WhatsAppConfig } from './whatsapp';

export interface AppOptions {
  db: Db;
  save: () => void;
  devMode: boolean;
  grader?: Grader;
  webDist?: string;
  sendWhatsApp?: (msg: OutboundMessage) => void | Promise<void>;
  sendOtp?: (phone: string, code: string) => void;
  /** Real WhatsApp for pitch demos: messages for registered sample parents go to real phones. */
  whatsApp?: { config: WhatsAppConfig; routesFile?: string; fetchFn?: typeof fetch };
}

type AuthedRequest = Request & { user?: User; token?: string };

export function createApp(opts: AppOptions) {
  let live: WhatsAppLive | null = null;
  const onMessage = async (m: OutboundMessage) => { await opts.sendWhatsApp?.(m); await live?.handle(m); };
  const portal = new Portal(opts.db, { grader: opts.grader, onChange: opts.save, onMessage });
  if (opts.whatsApp) live = new WhatsAppLive(opts.whatsApp.config, portal, opts.whatsApp.routesFile, opts.whatsApp.fetchFn);
  const auth = new OtpAuth(opts.devMode, opts.sendOtp ?? (() => {}));
  const app = express();
  app.disable('x-powered-by');
  // Keep the raw body so WhatsApp webhook signatures can be checked.
  app.use(express.json({ limit: '80mb', verify: (req, _res, buf) => { (req as Request & { rawBody?: Buffer }).rawBody = buf; } }));
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'");
    next();
  });

  const phoneOf = (raw: unknown) => String(raw ?? '').replace(/\D/g, '').slice(-10);

  app.get('/api/health', (_req, res) => { res.json({ ok: true, grader: portal.grader.name, devMode: opts.devMode }); });

  app.get('/api/config', (_req, res) => {
    res.json({
      devMode: opts.devMode,
      grader: portal.grader.name,
      demoAccounts: opts.devMode ? opts.db.users.filter((u) => u.listed !== false && !u.removedAt).map((u) => ({ phone: u.phone, name: u.name, role: u.role, school: opts.db.schools.find((s) => s.id === u.schoolId)?.shortName ?? 'Enticra' })) : [],
    });
  });

  app.post('/api/auth/request', (req, res) => {
    const phone = phoneOf(req.body?.phone);
    if (phone.length !== 10) return void res.status(400).json({ error: 'Enter a 10-digit mobile number.' });
    // Same answer whether or not the number has an account, so numbers cannot be probed.
    if (portal.deactivatedPhone(phone)) return void res.status(403).json({ error: 'This sign-in was turned off because the student has left the school. Please contact the school office.' });
    if (!portal.userByPhone(phone)) return void res.json({ sent: true });
    try { res.json(auth.request(phone)); } catch (e) { res.status(429).json({ error: (e as Error).message }); }
  });

  app.post('/api/auth/verify', (req, res) => {
    const phone = phoneOf(req.body?.phone);
    const user = portal.userByPhone(phone);
    if (!user || !auth.verify(phone, String(req.body?.code ?? ''))) return void res.status(401).json({ error: 'That code is wrong or has expired. Request a new one.' });
    res.json({ token: auth.createSession(user.id), ...portal.me(user) });
  });

  const requireUser = (req: AuthedRequest, res: Response, next: NextFunction) => {
    const token = req.header('authorization')?.replace(/^Bearer\s+/i, '');
    const userId = auth.resolve(token);
    const user = userId ? portal.sessionUser(userId) : undefined;
    if (!user) return void res.status(401).json({ error: 'Please sign in again.' });
    req.user = user;
    req.token = token;
    next();
  };

  app.post('/api/auth/logout', requireUser, (req: AuthedRequest, res) => { auth.revoke(req.token!); res.json({ ok: true }); });

  const allowed = new Set<string>(RPC_METHODS);
  app.post('/api/rpc/:method', requireUser, async (req: AuthedRequest, res) => {
    const method = String(req.params.method);
    if (!allowed.has(method)) return void res.status(404).json({ error: 'Unknown action.' });
    const args = Array.isArray(req.body?.args) ? req.body.args : [];
    try {
      if (method === 'gradeScripts') {
        // Grading can take minutes with the real AI; check access now, run in the background, let the client poll getExam.
        portal.getExam(req.user!, String(args[0]));
        portal.gradeScripts(req.user!, String(args[0]), args[1]).catch((e) => console.error('grading failed', e));
        return void res.json({ started: true });
      }
      if (method === 'uploadScript' && args[0] && typeof args[0] === 'object') {
        // Convert HEIC, split PDFs, turn photos upright and fix dark pages before the portal stores them.
        portal.getExam(req.user!, String((args[0] as { examId?: unknown }).examId));
        const prepared = await preparePages((args[0] as { pages: ScriptPage[] }).pages);
        args[0] = { ...(args[0] as object), pages: prepared.pages };
      }
      const fn = (portal as unknown as Record<string, (...a: unknown[]) => unknown>)[method];
      const result = await fn.call(portal, req.user, ...args);
      res.json({ result });
    } catch (e) {
      if (e instanceof PageError) return void res.status(400).json({ error: e.message });
      if (e instanceof PortalError) return void res.status(e.status).json({ error: e.message });
      console.error(e);
      res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
    }
  });

  // ---------------------------------------------------------------- live WhatsApp (pitch demos)

  app.get('/api/whatsapp/webhook', (req, res) => {
    const challenge = live?.verify(req.query as Record<string, unknown>);
    if (challenge == null) return void res.sendStatus(403);
    res.type('text/plain').send(challenge);
  });
  app.post('/api/whatsapp/webhook', (req, res) => {
    if (!live || !live.signed((req as Request & { rawBody?: Buffer }).rawBody, req.header('x-hub-signature-256'))) return void res.sendStatus(401);
    live.receive(req.body);
    res.sendStatus(200);
  });
  const principalOnly = (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (req.user?.role !== 'principal' || !req.user.schoolId) return void res.status(403).json({ error: 'Only the principal can set up live WhatsApp.' });
    next();
  };
  const routesView = (schoolId: string) => ({
    enabled: !!live,
    mode: live?.mode ?? null,
    routes: live?.listRoutes(schoolId) ?? [],
    // One row per parent (a parent with two children appears once); only parents who consented to WhatsApp can be linked.
    parents: [...new Map(opts.db.students.filter((s) => s.schoolId === schoolId && s.consent.whatsapp).map((s) => [s.guardian.phone, { samplePhone: s.guardian.phone, guardianName: s.guardian.name, studentName: s.name }])).values()],
  });
  app.post('/api/whatsapp/routes', requireUser, principalOnly, (req: AuthedRequest, res) => { res.json(routesView(req.user!.schoolId!)); });
  app.post('/api/whatsapp/routes/set', requireUser, principalOnly, (req: AuthedRequest, res) => {
    if (!live) return void res.status(409).json({ error: 'Live WhatsApp is not set up on this server.' });
    try { live.setRoute(req.user!.schoolId!, phoneOf(req.body?.samplePhone), String(req.body?.realPhone ?? '')); res.json(routesView(req.user!.schoolId!)); }
    catch (e) { res.status(400).json({ error: (e as Error).message }); }
  });
  app.post('/api/whatsapp/routes/remove', requireUser, principalOnly, (req: AuthedRequest, res) => {
    live?.removeRoute(req.user!.schoolId!, phoneOf(req.body?.samplePhone));
    res.json(routesView(req.user!.schoolId!));
  });
  app.post('/api/whatsapp/test', requireUser, principalOnly, async (req: AuthedRequest, res) => {
    if (!live) return void res.status(409).json({ error: 'Live WhatsApp is not set up on this server.' });
    const r = await live.sendTest(req.user!.schoolId!, phoneOf(req.body?.samplePhone));
    res.status(r.ok ? 200 : 502).json(r.ok ? r : { error: r.error });
  });

  if (opts.webDist && existsSync(opts.webDist)) {
    app.use(express.static(opts.webDist, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(join(opts.webDist!, 'index.html')));
  }
  return { app, portal, auth, live };
}
