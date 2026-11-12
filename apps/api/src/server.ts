import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mockGrader, type OutboundMessage } from '@enticra/core';
import { createApp } from './app';
import { createClaudeGrader } from './claudeGrader';
import { openStoreFromEnv } from './store';
import { whatsAppConfigFromEnv } from './whatsapp';

const here = dirname(fileURLToPath(import.meta.url));
// Settings can live in a .env file at the project root (never commit it: it holds keys).
const envFile = join(here, '..', '..', '..', '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
const dataDir = process.env.DATA_DIR ?? join(here, '..', 'data');
const port = Number(process.env.PORT ?? 8787);
const devMode = process.env.NODE_ENV !== 'production' || process.env.DEMO_LOGIN === '1';
mkdirSync(dataDir, { recursive: true });

// Data lives in PostgreSQL: DATABASE_URL if set, otherwise a built-in PostgreSQL in DATA_DIR/pgdata.
// Sample data is loaded only into an empty database; every change is saved automatically.
const store = await openStoreFromEnv(process.env, dataDir);
const grader = process.env.ANTHROPIC_API_KEY ? createClaudeGrader({ model: process.env.GRADER_MODEL }) : mockGrader;

// Every message is logged to data/outbox.log. With the WHATSAPP_* settings, messages for parents linked
// to a real phone (Settings, Live WhatsApp) also go out through the WhatsApp Cloud API; see docs/whatsapp-live-demo.md.
const whatsAppConfig = whatsAppConfigFromEnv(process.env);
const outbox = join(dataDir, 'outbox.log');
const sendWhatsApp = (m: OutboundMessage) => appendFileSync(outbox, `${m.createdAt}\t${m.to}\t${m.template}\t${m.body}\n`);
const sendOtp = (phone: string, code: string) => console.log(`[otp] ${phone}: ${devMode ? code : '******'}`);

const created = createApp({ db: store.db, save: store.save, devMode, grader, webDist: join(here, '..', '..', 'web', 'dist'), sendWhatsApp, sendOtp,
  whatsApp: whatsAppConfig ? { config: whatsAppConfig, routesFile: join(dataDir, 'whatsapp-routes.json') } : undefined });
const { portal } = created;

// Messages held for quiet hours go out when the quiet hours end.
setInterval(() => portal.releaseScheduled(), 60_000).unref();

created.app.listen(port, () => {
  console.log(`Enticra School API on http://localhost:${port}  (database: ${store.kind}, grader: ${grader.name}, demo login: ${devMode ? 'on, code 123456' : 'off'}, live WhatsApp: ${created.live ? created.live.mode : 'off'})`);
});

// Write anything still pending before the process stops.
const shutdown = () => { store.close().catch((e) => console.error('[db]', e.message)).finally(() => process.exit(0)); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
