// Local Postgres-compatible database for development without Neon.
// Usage: npm run localdb   →  DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/postgres
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const dataDir = process.argv.includes('--memory') ? undefined : './.localdb';
const db = await PGlite.create(dataDir);
const server = new PGLiteSocketServer({ db, port: 5433, host: '127.0.0.1', maxConnections: 20 });
await server.start();
console.log(`[localdb] PGlite listening on 127.0.0.1:5433 (${dataDir ?? 'in memory'})`);

const stop = async () => {
  await server.stop();
  await db.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
