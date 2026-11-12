import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp, { type Sharp } from 'sharp';
import heicConvert from 'heic-convert';
import type { ScriptPage } from '@enticra/core';

/**
 * Turns whatever a teacher uploads into clean JPEG pages that Claude and the
 * review screen can both use. Handles:
 *  - phone photos in any common format (JPEG, PNG, WebP, AVIF, TIFF, GIF, BMP)
 *  - iPhone HEIC/HEIF photos, which Chrome and Windows browsers cannot open
 *  - PDFs from scanner apps, split into one image per page
 *  - sideways photos, turned upright from the camera's orientation tag
 *  - dark or washed-out photos, given a gentle contrast boost
 * Every page comes out as a JPEG no larger than MAX_SIDE on its longest edge.
 */

export const MAX_PAGES = 12;
/** Long enough for small handwriting; Claude reads up to about this size without downscaling much. */
export const MAX_SIDE = 2000;
/** Largest single upload we accept before processing (decoded bytes). */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export class PageError extends Error {}

type Kind = 'pdf' | 'heic' | 'image';

/** Detect the real file type from its first bytes; browsers often send HEIC as application/octet-stream. */
export function sniff(buf: Buffer): Kind {
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (buf.length > 12 && buf.subarray(4, 8).toString('latin1') === 'ftyp') {
    const brand = buf.subarray(8, 12).toString('latin1');
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)) return 'heic';
  }
  return 'image';
}

function decodeDataUrl(dataUrl: string): Buffer {
  const m = /^data:[^;,]*(?:;[^;,]*)*;base64,(.*)$/s.exec(dataUrl);
  if (!m) throw new PageError('One of the pages could not be read. Please add it again.');
  const buf = Buffer.from(m[1], 'base64');
  if (!buf.length) throw new PageError('One of the pages is empty. Please add it again.');
  if (buf.length > MAX_UPLOAD_BYTES) throw new PageError('One of the files is larger than 25 MB. Please take the photo again at a lower size.');
  return buf;
}

/** Brightness at the given fraction (0..1) of the pixels, from a 0..255 histogram. */
function percentile(hist: number[], total: number, q: number): number {
  let seen = 0;
  for (let v = 0; v < 256; v++) { seen += hist[v]; if (seen >= total * q) return v; }
  return 255;
}

/**
 * Work out a brightness stretch for dim or washed-out photos. Paper fills most
 * of a page, so a high percentile is the paper colour and a very low one is the
 * ink. Paper is lifted to near white and ink pulled towards black. Returns null
 * when the paper already looks white.
 */
export function contrastFix(hist: number[], total: number): { a: number; b: number } | null {
  const paper = percentile(hist, total, 0.9);
  if (paper >= 215) return null; // paper already looks white
  // Sparse writing can be under 0.5% of the pixels; never let the ink point sit on the paper.
  const ink = Math.min(percentile(hist, total, 0.005), Math.round(paper * 0.45));
  const a = Math.min(4, 245 / Math.max(1, paper - ink));
  return { a, b: -a * ink };
}

/** Upright, resized, contrast-fixed JPEG. Returns the data URL and whether it was brightened. */
export async function cleanImage(input: Buffer): Promise<{ dataUrl: string; enhanced: boolean }> {
  let base: Sharp;
  let grey: Buffer;
  try {
    // rotate() with no angle applies the EXIF orientation, so sideways phone photos come out upright.
    base = sharp(input, { failOn: 'none', limitInputPixels: 120_000_000 }).rotate().resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' });
    grey = await base.clone().resize({ width: 400, height: 400, fit: 'inside' }).greyscale().raw().toBuffer();
  } catch {
    throw new PageError('One of the files is not a photo or PDF we can open. Please use JPG, PNG, HEIC or PDF.');
  }
  const hist = new Array<number>(256).fill(0);
  for (const v of grey) hist[v]++;
  const fix = contrastFix(hist, grey.length);
  const pipe = fix ? base.linear(fix.a, fix.b) : base;
  const out = await pipe.jpeg({ quality: 85, mozjpeg: true }).toBuffer();
  return { dataUrl: `data:image/jpeg;base64,${out.toString('base64')}`, enhanced: !!fix };
}

async function heicToJpeg(buf: Buffer): Promise<Buffer> {
  try {
    const out = await heicConvert({ buffer: new Uint8Array(buf), format: 'JPEG', quality: 0.92 });
    return Buffer.from(out);
  } catch {
    throw new PageError('An iPhone photo (HEIC) could not be opened. Please take it again, or set the camera to "Most Compatible".');
  }
}

const require = createRequire(import.meta.url);
let fontUrl: string | undefined;
function standardFonts(): string | undefined {
  if (fontUrl !== undefined) return fontUrl || undefined;
  try { fontUrl = pathToFileURL(join(dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts')).href + '/'; } catch { fontUrl = ''; }
  return fontUrl || undefined;
}

/** Render each PDF page to a PNG at about MAX_SIDE on its long edge. */
async function pdfToImages(buf: Buffer, limit: number): Promise<Buffer[]> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { createCanvas } = await import('@napi-rs/canvas');
  const task = getDocument({ data: new Uint8Array(buf), standardFontDataUrl: standardFonts(), verbosity: 0 });
  let doc;
  try {
    doc = await task.promise;
  } catch {
    await task.destroy().catch(() => undefined);
    throw new PageError('That PDF could not be opened. If it has a password, remove it and upload again.');
  }
  try {
    if (doc.numPages > limit) throw new PageError(`That PDF has ${doc.numPages} pages. A script can have at most ${MAX_PAGES} pages.`);
    const out: Buffer[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const unit = page.getViewport({ scale: 1 });
      const scale = Math.min(4, MAX_SIDE / Math.max(unit.width, unit.height));
      const vp = page.getViewport({ scale });
      const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport: vp }).promise;
      out.push(canvas.toBuffer('image/png'));
      page.cleanup();
    }
    return out;
  } finally {
    await task.destroy();
  }
}

export interface PreparedPages { pages: ScriptPage[]; enhanced: number }

/**
 * Normalise an upload: every page with a dataUrl is converted; a PDF expands
 * into several pages. Typed transcripts (sample scripts) pass through as-is.
 */
export async function preparePages(input: ScriptPage[]): Promise<PreparedPages> {
  if (!Array.isArray(input) || !input.length) throw new PageError('Add at least one page.');
  const pages: ScriptPage[] = [];
  let enhanced = 0;
  for (const p of input) {
    if (!p?.dataUrl) { pages.push(p); continue; }
    const buf = decodeDataUrl(p.dataUrl);
    const kind = sniff(buf);
    const images = kind === 'pdf' ? await pdfToImages(buf, MAX_PAGES - pages.length) : [kind === 'heic' ? await heicToJpeg(buf) : buf];
    for (const img of images) {
      if (pages.length >= MAX_PAGES) throw new PageError(`A script can have at most ${MAX_PAGES} pages.`);
      const clean = await cleanImage(img);
      if (clean.enhanced) enhanced++;
      pages.push({ ...p, dataUrl: clean.dataUrl });
    }
  }
  return { pages, enhanced };
}
