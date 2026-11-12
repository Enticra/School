import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

const OTP_TTL_MS = 5 * 60_000;
const SESSION_TTL_MS = 12 * 60 * 60_000;
const MAX_ATTEMPTS = 5;
const MAX_REQUESTS_PER_10_MIN = 5;

interface Pending { hash: Buffer; expires: number; attempts: number }
interface Session { userId: string; expires: number }

const sha = (s: string) => createHash('sha256').update(s).digest();

/**
 * Phone + one-time-code login. Codes are hashed in memory and expire after five
 * minutes. In dev mode the code is always 123456 so the demo accounts work
 * without a WhatsApp or SMS provider.
 */
export class OtpAuth {
  private pending = new Map<string, Pending>();
  private requests = new Map<string, number[]>();
  private sessions = new Map<string, Session>();

  constructor(private devMode: boolean, private deliver: (phone: string, code: string) => void) {}

  request(phone: string): { sent: boolean; devCode?: string } {
    const now = Date.now();
    const recent = (this.requests.get(phone) ?? []).filter((t) => now - t < 10 * 60_000);
    if (recent.length >= MAX_REQUESTS_PER_10_MIN) throw new Error('Too many codes requested. Wait 10 minutes and try again.');
    recent.push(now);
    this.requests.set(phone, recent);
    const code = this.devMode ? '123456' : String(randomInt(0, 1_000_000)).padStart(6, '0');
    this.pending.set(phone, { hash: sha(code), expires: now + OTP_TTL_MS, attempts: 0 });
    this.deliver(phone, code);
    return { sent: true, devCode: this.devMode ? code : undefined };
  }

  verify(phone: string, code: string): boolean {
    const p = this.pending.get(phone);
    if (!p || p.expires < Date.now()) return false;
    p.attempts++;
    if (p.attempts > MAX_ATTEMPTS) { this.pending.delete(phone); return false; }
    const ok = timingSafeEqual(p.hash, sha(String(code)));
    if (ok) this.pending.delete(phone);
    return ok;
  }

  createSession(userId: string): string {
    const token = randomBytes(32).toString('base64url');
    this.sessions.set(token, { userId, expires: Date.now() + SESSION_TTL_MS });
    return token;
  }

  resolve(token: string | undefined): string | null {
    if (!token) return null;
    const s = this.sessions.get(token);
    if (!s || s.expires < Date.now()) { if (s) this.sessions.delete(token); return null; }
    return s.userId;
  }

  revoke(token: string) { this.sessions.delete(token); }
}
