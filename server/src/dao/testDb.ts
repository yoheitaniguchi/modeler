import { Pool, types } from 'pg';
import { randomUUID } from 'node:crypto';

types.setTypeParser(1082, (v: string) => v);

/**
 * テスト用 PostgreSQL ハンドル。
 *
 * 1 テスト = 1 スキーマ で隔離する。テーブル名衝突や順序依存を抑え、
 * 並列実行しても干渉しない。afterEach で DROP SCHEMA CASCADE する。
 *
 * 接続先は TEST_DATABASE_URL > DATABASE_URL の優先順。どちらも未設定なら
 * available=false を返し、テスト本体は describe.skipIf 等でスキップする。
 */
export interface TestDbHandle {
  pool: Pool;
  schema: string;
  cleanup: () => Promise<void>;
}

export function getTestDbUrl(): string | undefined {
  return process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
}

export const TEST_DB_AVAILABLE = (() => {
  const url = getTestDbUrl();
  return typeof url === 'string' && url.trim() !== '';
})();

export async function createTestDb(): Promise<TestDbHandle> {
  const url = getTestDbUrl();
  if (!url) throw new Error('TEST_DATABASE_URL (or DATABASE_URL) is not set');

  const schema = `test_${randomUUID().replace(/-/g, '')}`;
  // schema を search_path に固定したプールを作成 (options を通じて全接続に伝播)
  const pool = new Pool({
    connectionString: url,
    options: `-c search_path=${schema}`,
  });

  // 初期接続でスキーマを作成する。options の search_path はそのスキーマが
  // 既に存在することを前提にしないので、まずスキーマだけ作る。
  const admin = await pool.connect();
  try {
    await admin.query(`CREATE SCHEMA ${quote(schema)}`);
    await admin.query(`SET search_path TO ${quote(schema)}`);
  } finally {
    admin.release();
  }

  const cleanup = async () => {
    const c = await pool.connect();
    try {
      await c.query(`DROP SCHEMA IF EXISTS ${quote(schema)} CASCADE`);
    } finally {
      c.release();
    }
    await pool.end();
  };

  return { pool, schema, cleanup };
}

function quote(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}
