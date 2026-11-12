import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStoreFromEnv } from './store';

// Replaces everything in the database with fresh sample data. Stop the server first.
// Usage: npm run db:reset -- --yes
const here = dirname(fileURLToPath(import.meta.url));
const envFile = join(here, '..', '..', '..', '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
if (!process.argv.includes('--yes')) {
  console.log('This deletes every change saved in the database and loads the sample data again.\nRun it again with --yes to go ahead:  npm run db:reset -- --yes');
  process.exit(1);
}
const dataDir = process.env.DATA_DIR ?? join(here, '..', 'data');
mkdirSync(dataDir, { recursive: true });
const store = await openStoreFromEnv(process.env, dataDir);
if (!store.seeded) await store.reset();
await store.close();
console.log(`Sample data loaded into ${store.kind}.`);
