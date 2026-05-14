import { Pool, types } from 'pg';

/**
 * Postgres 接続プールのシングルトン。
 *
 * 設計方針:
 *   - DAO ごとに Pool を作ると接続が枯渇しやすい。1 プロセス = 1 プール。
 *   - lazy 初期化にして、テストが closePool() で確実に破棄できるようにする。
 *   - DATE 型 (OID=1082) は ISO 文字列のまま返す。JSON 永続化時代との互換と、
 *     validateRecord が typeof === 'string' を期待しているため。
 */

types.setTypeParser(1082, (value: string) => value);

let pool: Pool | undefined;
let configured: string | undefined;

export function getPool(): Pool {
  const url = process.env.DATABASE_URL;
  if (!url || url.trim() === '') {
    throw new Error('DATABASE_URL is not set. Configure it in .env or environment.');
  }
  if (pool && configured === url) {
    return pool;
  }
  if (pool && configured !== url) {
    void pool.end().catch(() => undefined);
  }
  pool = new Pool({ connectionString: url });
  configured = url;
  return pool;
}

export async function closePool(): Promise<void> {
  if (!pool) return;
  const p = pool;
  pool = undefined;
  configured = undefined;
  await p.end();
}
