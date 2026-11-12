import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import request from 'supertest';
import { createSeed } from '@enticra/core';
import { createApp } from '../src/app';
import { MAX_SIDE, PageError, preparePages, sniff } from '../src/pages';

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name));
const toUrl = (buf: Buffer, mime: string) => `data:${mime};base64,${buf.toString('base64')}`;
const decode = (dataUrl: string) => Buffer.from(dataUrl.split(',')[1], 'base64');

/** A landscape-stored photo whose camera tag says "turn 90° clockwise", like a phone held upright. */
async function sidewaysPhoto() {
  return sharp({ create: { width: 800, height: 600, channels: 3, background: '#f4f1ea' } })
    .composite([{ input: Buffer.from('<svg width="800" height="600"><text x="40" y="300" font-size="60">x = 2</text></svg>') }])
    .jpeg().withMetadata({ orientation: 6 }).toBuffer();
}

describe('preparePages', () => {
  it('turns a sideways phone photo upright using its orientation tag', async () => {
    const { pages } = await preparePages([{ dataUrl: toUrl(await sidewaysPhoto(), 'image/jpeg') }]);
    const meta = await sharp(decode(pages[0].dataUrl!)).metadata();
    expect(pages[0].dataUrl).toMatch(/^data:image\/jpeg;base64,/);
    expect([meta.width, meta.height]).toEqual([600, 800]);
    expect(meta.orientation ?? 1).toBe(1);
  });

  it('converts an iPhone HEIC photo even when the browser labels it octet-stream', async () => {
    const heic = fixture('page.heic');
    expect(sniff(heic)).toBe('heic');
    const { pages } = await preparePages([{ dataUrl: toUrl(heic, 'application/octet-stream') }]);
    const meta = await sharp(decode(pages[0].dataUrl!)).metadata();
    expect(meta.format).toBe('jpeg');
    expect([meta.width, meta.height]).toEqual([300, 200]);
  });

  it('splits a PDF from a scanner app into one page per sheet', async () => {
    const { pages } = await preparePages([{ dataUrl: toUrl(fixture('two-pages.pdf'), 'application/pdf') }, { dataUrl: toUrl(await sidewaysPhoto(), 'image/jpeg') }]);
    expect(pages).toHaveLength(3);
    const first = await sharp(decode(pages[0].dataUrl!)).metadata();
    expect(first.format).toBe('jpeg');
    expect(Math.max(first.width!, first.height!)).toBeLessThanOrEqual(MAX_SIDE);
    expect(first.height!).toBeGreaterThan(first.width!);
  });

  it('brightens a photo taken in a dim room and shrinks a huge one', async () => {
    const dark = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: '#555048' } })
      .composite([{ input: Buffer.from('<svg width="4000" height="3000"><rect x="500" y="500" width="3000" height="120" fill="#1e1e1e"/></svg>') }])
      .png().toBuffer();
    const { pages, enhanced } = await preparePages([{ dataUrl: toUrl(dark, 'image/png') }]);
    expect(enhanced).toBe(1);
    const out = sharp(decode(pages[0].dataUrl!));
    const meta = await out.metadata();
    expect(Math.max(meta.width!, meta.height!)).toBe(MAX_SIDE);
    const before = (await sharp(dark).greyscale().stats()).channels[0].mean;
    const after = (await out.greyscale().stats()).channels[0].mean;
    expect(after).toBeGreaterThan(before + 20);
  });

  it('keeps sparse writing on grey paper readable: paper turns light, ink stays dark', async () => {
    // A grey page with one thin line of writing, so ink is well under 1% of the pixels.
    const grey = await sharp({ create: { width: 1200, height: 900, channels: 3, background: '#8a8478' } })
      .composite([{ input: Buffer.from('<svg width="1200" height="900"><rect x="60" y="300" width="600" height="3" fill="#222"/></svg>') }])
      .jpeg().toBuffer();
    const { pages, enhanced } = await preparePages([{ dataUrl: toUrl(grey, 'image/jpeg') }]);
    expect(enhanced).toBe(1);
    const { data, info } = await sharp(decode(pages[0].dataUrl!)).greyscale().raw().toBuffer({ resolveWithObject: true });
    expect(data[100 * info.width + 100]).toBeGreaterThan(220); // paper
    expect(data[301 * info.width + 300]).toBeLessThan(90); // ink
  });

  it('leaves a clean white scan as it is', async () => {
    const white = await sharp({ create: { width: 800, height: 1000, channels: 3, background: '#ffffff' } })
      .composite([{ input: Buffer.from('<svg width="800" height="1000"><text x="40" y="200" font-size="60">x = 2</text></svg>') }]).png().toBuffer();
    expect((await preparePages([{ dataUrl: toUrl(white, 'image/png') }])).enhanced).toBe(0);
  });

  it('leaves typed sample pages alone and rejects files that are not images', async () => {
    const { pages } = await preparePages([{ transcript: { '1': 'x = 2' } }]);
    expect(pages).toEqual([{ transcript: { '1': 'x = 2' } }]);
    await expect(preparePages([{ dataUrl: toUrl(Buffer.from('hello, not a photo'), 'text/plain') }])).rejects.toBeInstanceOf(PageError);
  });
});

describe('uploading through the API', () => {
  it('accepts a PDF and a HEIC photo for a script and stores clean JPEG pages', async () => {
    const db = createSeed(new Date(2026, 9, 26, 9, 0));
    const { app } = createApp({ db, save: () => {}, devMode: true });
    await request(app).post('/api/auth/request').send({ phone: '9840022222' }).expect(200);
    const token = (await request(app).post('/api/auth/verify').send({ phone: '9840022222', code: '123456' }).expect(200)).body.token as string;
    const exam = db.exams.find((e) => e.classId === 'cls_s1_10a' && e.subject === 'Maths')!;
    const student = db.students.find((s) => s.classId === 'cls_s1_10a' && !db.scripts.some((x) => x.studentId === s.id && x.examId === exam.id))!;
    const pages = [{ dataUrl: toUrl(fixture('two-pages.pdf'), 'application/pdf') }, { dataUrl: toUrl(fixture('page.heic'), 'image/heic') }];
    const res = await request(app).post('/api/rpc/uploadScript').set('authorization', `Bearer ${token}`).send({ args: [{ examId: exam.id, studentId: student.id, pages }] }).expect(200);
    expect(res.body.result.pages).toHaveLength(3);
    for (const p of res.body.result.pages) expect(p.dataUrl).toMatch(/^data:image\/jpeg;base64,/);

    const bad = await request(app).post('/api/rpc/uploadScript').set('authorization', `Bearer ${token}`).send({ args: [{ examId: exam.id, studentId: student.id, pages: [{ dataUrl: 'data:text/plain;base64,aGVsbG8=' }] }] }).expect(400);
    expect(bad.body.error).toMatch(/JPG, PNG, HEIC or PDF/);
  });
});
