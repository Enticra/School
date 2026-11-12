import { describe, expect, it, vi, onTestFinished } from 'vitest';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { createSeed } from '@enticra/core';
import { createApp } from '../src/app';

function setup() {
  const db = createSeed(new Date(2026, 9, 26, 9, 0));
  return createApp({ db, save: () => {}, devMode: true });
}

async function login(app: ReturnType<typeof setup>['app'], phone: string) {
  await request(app).post('/api/auth/request').send({ phone }).expect(200);
  const res = await request(app).post('/api/auth/verify').send({ phone, code: '123456' }).expect(200);
  return res.body.token as string;
}

describe('API', () => {
  it('signs in with phone and code', async () => {
    const { app } = setup();
    const token = await login(app, '98400 11111');
    const me = await request(app).post('/api/rpc/me').set('authorization', `Bearer ${token}`).send({ args: [] }).expect(200);
    expect(me.body.result.user.role).toBe('principal');
  });
  it('rejects a wrong code and unknown sessions', async () => {
    const { app } = setup();
    await request(app).post('/api/auth/request').send({ phone: '9840011111' });
    await request(app).post('/api/auth/verify').send({ phone: '9840011111', code: '000000' }).expect(401);
    await request(app).post('/api/rpc/me').set('authorization', 'Bearer nope').send({ args: [] }).expect(401);
  });
  it('does not reveal whether a number has an account', async () => {
    const { app } = setup();
    const res = await request(app).post('/api/auth/request').send({ phone: '9123456789' }).expect(200);
    expect(res.body).toEqual({ sent: true });
  });
  it('signs out and blocks a student who has left the school', async () => {
    const { app } = setup();
    const student = await login(app, '9840055555');
    const advisor = await login(app, '9840033333');
    await request(app).post('/api/rpc/removeStudent').set('authorization', `Bearer ${advisor}`).send({ args: ['stu_cls_s1_10a_1', { reason: 'Transfer certificate issued' }] }).expect(200);
    await request(app).post('/api/rpc/me').set('authorization', `Bearer ${student}`).send({ args: [] }).expect(401);
    const res = await request(app).post('/api/auth/request').send({ phone: '9840055555' }).expect(403);
    expect(res.body.error).toMatch(/left the school/);
    await request(app).post('/api/rpc/restoreStudent').set('authorization', `Bearer ${advisor}`).send({ args: ['stu_cls_s1_10a_1'] }).expect(200);
    await login(app, '9840055555');
  });
  it('enforces tenant isolation over HTTP', async () => {
    const { app } = setup();
    const token = await login(app, '9841011111');
    const res = await request(app).post('/api/rpc/getStudent').set('authorization', `Bearer ${token}`).send({ args: ['stu_cls_s1_10a_1'] });
    expect(res.status).toBe(403);
  });
  it('rejects methods outside the allowlist', async () => {
    const { app } = setup();
    const token = await login(app, '9840011111');
    await request(app).post('/api/rpc/constructor').set('authorization', `Bearer ${token}`).send({ args: [] }).expect(404);
    await request(app).post('/api/rpc/send').set('authorization', `Bearer ${token}`).send({ args: [] }).expect(404);
  });
  it('starts AI grading in the background', async () => {
    const { app, portal } = setup();
    const token = await login(app, '9840022222');
    await request(app).post('/api/rpc/gradeScripts').set('authorization', `Bearer ${token}`).send({ args: ['exm_s1_10a_maths_revision1'] }).expect(200);
    await new Promise((r) => setTimeout(r, 50));
    expect(portal.db.scripts.every((s) => s.status === 'graded')).toBe(true);
  });
});

describe('live WhatsApp for demos', () => {
  const config = { token: 't', phoneNumberId: '123', appSecret: 'secret', verifyToken: 'v' };
  function liveSetup() {
    const calls: { to: string; body: string }[] = [];
    const fetchFn = (async (_url: string, init: { body: string }) => {
      const b = JSON.parse(init.body);
      calls.push({ to: b.to, body: b.text?.body ?? '' });
      return new Response(JSON.stringify({ messages: [{ id: `wamid.${calls.length}` }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const db = createSeed(new Date(2026, 9, 26, 9, 0));
    return { calls, ...createApp({ db, save: () => {}, devMode: true, whatsApp: { config, fetchFn } }) };
  }
  const sign = (raw: string) => `sha256=${createHmac('sha256', 'secret').update(raw).digest('hex')}`;

  it('sends only to registered phones and tracks real ticks', async () => {
    // A school-day morning, outside quiet hours, so the message goes out at once.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 26, 11, 0));
    onTestFinished(() => { vi.useRealTimers(); });
    const { app, portal, calls } = liveSetup();
    const token = await login(app, '9840011111');
    const auth = { authorization: `Bearer ${token}` };
    const view = await request(app).post('/api/whatsapp/routes').set(auth).send({}).expect(200);
    const parent = view.body.parents[0];
    await request(app).post('/api/whatsapp/routes/set').set(auth).send({ samplePhone: parent.samplePhone, realPhone: '98765 43210' }).expect(200);
    const routes = await request(app).post('/api/whatsapp/routes').set(auth).send({}).expect(200);
    expect(routes.body.routes[0]).toMatchObject({ phoneEnding: '3210' });
    expect(JSON.stringify(routes.body)).not.toContain('9876543210');

    const teacher = portal.userById('u_s1_maths')!;
    portal.createHomework(teacher, { classId: 'cls_s1_10a', subject: 'Maths', title: 'Exercise 8.3', dueDate: new Date(Date.now() + 864e5).toISOString().slice(0, 10) });
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toHaveLength(1);
    expect(calls[0].to).toBe('919876543210');
    const msg = portal.db.messages.find((m) => m.providerId === 'wamid.1')!;
    expect(msg.live).toBe(true);

    const hook = JSON.stringify({ entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.1', status: 'read' }] } }] }] });
    await request(app).post('/api/whatsapp/webhook').set('content-type', 'application/json').set('x-hub-signature-256', 'sha256=bad').send(hook).expect(401);
    expect(msg.status).toBe('sent');
    await request(app).post('/api/whatsapp/webhook').set('content-type', 'application/json').set('x-hub-signature-256', sign(hook)).send(hook).expect(200);
    expect(msg.status).toBe('read');
  });
  it('answers Meta’s webhook check only with the right token, and keeps setup to the principal', async () => {
    const { app } = liveSetup();
    await request(app).get('/api/whatsapp/webhook').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'v', 'hub.challenge': '42' }).expect(200, '42');
    await request(app).get('/api/whatsapp/webhook').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'x', 'hub.challenge': '42' }).expect(403);
    const token = await login(app, '9840022222');
    await request(app).post('/api/whatsapp/routes').set('authorization', `Bearer ${token}`).send({}).expect(403);
  });
});
