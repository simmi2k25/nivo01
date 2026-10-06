import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { config } from './config.js';

// BIGINT ids come back as JS numbers (they stay far below 2^53).
pg.types.setTypeParser(20, (v) => Number(v));

function sslOptions(url: string): pg.PoolConfig {
  const u = new URL(url);
  const mode = u.searchParams.get('sslmode');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (local && !mode) return {};
  const opts: pg.PoolConfig & { enableChannelBinding?: boolean } = {
    ssl: { rejectUnauthorized: true },
  };
  if (u.hostname.endsWith('.neon.tech') || u.searchParams.get('channel_binding') === 'require') {
    opts.enableChannelBinding = true;
  }
  return opts;
}

function connectionString(url: string) {
  // TLS is configured explicitly above; drop libpq-only params pg would misread.
  const u = new URL(url);
  u.searchParams.delete('sslmode');
  u.searchParams.delete('channel_binding');
  return u.toString();
}

export const pool = new pg.Pool({
  connectionString: connectionString(config.databaseUrl),
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 15_000,
  ...sslOptions(config.databaseUrl),
});

pool.on('error', (err) => console.error('[db] idle client error', err.message));

export async function query<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = []) {
  return pool.query<T>(text, params);
}

export async function one<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = []) {
  const r = await pool.query<T>(text, params);
  return r.rows[0] as T | undefined;
}

export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/** Applies numbered SQL files from server/migrations once each, under an advisory lock. */
export async function migrate() {
  const dir = path.resolve(import.meta.dirname, '../migrations');
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const c = await pool.connect();
  try {
    await c.query('SELECT pg_advisory_lock(727274)');
    await c.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    const done = new Set((await c.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    for (const f of files) {
      const name = f.replace(/\.sql$/, '');
      if (done.has(name)) continue;
      const sql = await fs.readFile(path.join(dir, f), 'utf8');
      await c.query('BEGIN');
      try {
        await c.query(sql);
        await c.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
        await c.query('COMMIT');
        console.log(`[db] applied migration ${name}`);
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      }
    }
  } finally {
    await c.query('SELECT pg_advisory_unlock(727274)').catch(() => {});
    c.release();
  }
}
