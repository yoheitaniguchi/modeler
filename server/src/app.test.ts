import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { ModelDefinitionDocument } from '@modeler/shared';
import { createApp } from './app.js';
import { createTestDb, TEST_DB_AVAILABLE, type TestDbHandle } from './dao/testDb.js';
import { closePool } from './db/pool.js';

/**
 * E2E に近い API テスト。
 * デプロイ → CRUD → 破壊的変更 → force=true 再送 まで通しで検証する。
 *
 * Postgres を実際に使うため、テストごとに独自スキーマを作って隔離する。
 * pool.ts のシングルトンが TEST_DATABASE_URL を見るように、DATABASE_URL を
 * テスト用にセットし直してから createApp する。
 */

const document: ModelDefinitionDocument = {
  version: 1,
  models: [
    {
      name: 'customer',
      label: '顧客',
      fields: [
        { name: 'name', label: '氏名', type: 'string', required: true },
        { name: 'age', label: '年齢', type: 'number', required: false },
      ],
    },
  ],
};

let savedDatabaseUrl: string | undefined;

describe.skipIf(!TEST_DB_AVAILABLE)('app', () => {
  let db: TestDbHandle;
  let app: ReturnType<typeof createApp>['app'];

  beforeAll(() => {
    savedDatabaseUrl = process.env.DATABASE_URL;
  });

  afterAll(async () => {
    if (savedDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = savedDatabaseUrl;
    await closePool();
  });

  beforeEach(async () => {
    db = await createTestDb();
    // pool.ts は DATABASE_URL を見るため、search_path 付きの test URL に差し替える。
    process.env.DATABASE_URL = composeUrl(db);
    await closePool();
    app = createApp({ clientDistDir: 'nonexistent' }).app;
  });

  afterEach(async () => {
    await closePool();
    await db.cleanup();
  });

  it('GET /health は 200', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('未デプロイ時に CRUD パスは 404', async () => {
    const res = await request(app).get('/api/customer');
    expect(res.status).toBe(404);
  });

  it('壊れた document の deploy は 400', async () => {
    const res = await request(app).post('/meta/deploy').send({ version: 99, models: [] });
    expect(res.status).toBe(400);
    expect(res.body.errors.length).toBeGreaterThan(0);
  });

  it('deploy 後に CRUD が一通り動く', async () => {
    const dep = await request(app).post('/meta/deploy').send(document);
    expect(dep.status).toBe(200);

    expect((await request(app).get('/api/customer')).body).toEqual([]);

    const created = await request(app).post('/api/customer').send({ name: '山田太郎', age: 30 });
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    const got = await request(app).get(`/api/customer/${id}`);
    expect(got.status).toBe(200);
    expect(got.body.name).toBe('山田太郎');

    const upd = await request(app).put(`/api/customer/${id}`).send({ name: '山田次郎', age: 31 });
    expect(upd.status).toBe(200);
    expect(upd.body.name).toBe('山田次郎');

    const bad = await request(app).post('/api/customer').send({ age: 99 });
    expect(bad.status).toBe(400);

    const del = await request(app).delete(`/api/customer/${id}`);
    expect(del.status).toBe(204);

    const after = await request(app).get(`/api/customer/${id}`);
    expect(after.status).toBe(404);
  });

  it('GET /meta/models で現状を取得できる', async () => {
    await request(app).post('/meta/deploy').send(document);
    const res = await request(app).get('/meta/models');
    expect(res.body.models).toHaveLength(1);
    expect(res.body.models[0].name).toBe('customer');
  });

  it('DELETE /meta/models/:name で model を削除できる (テーブルも DROP)', async () => {
    await request(app).post('/meta/deploy').send(document);
    expect((await request(app).get('/meta/models')).body.models).toHaveLength(1);

    const del = await request(app).delete('/meta/models/customer');
    expect(del.status).toBe(204);

    expect((await request(app).get('/api/customer')).status).toBe(404);
    expect((await request(app).get('/meta/models')).body.models).toHaveLength(0);
  });

  it('PUT /meta/models/:name で安全な追加変更 (optional 列) はそのまま 200', async () => {
    await request(app).post('/meta/deploy').send(document);
    const created = await request(app).post('/api/customer').send({ name: '太郎', age: 30 });
    const id = created.body.id as string;

    const updated = {
      name: 'customer',
      label: '顧客 v2',
      fields: [
        { name: 'name', label: '氏名', type: 'string', required: true },
        { name: 'age', label: '年齢', type: 'number', required: false },
        { name: 'email', label: 'メール', type: 'string', required: false },
      ],
    };
    const upd = await request(app).put('/meta/models/customer').send(updated);
    expect(upd.status).toBe(200);
    expect(upd.body.model.label).toBe('顧客 v2');

    const got = await request(app).get(`/api/customer/${id}`);
    expect(got.status).toBe(200);
    expect(got.body.name).toBe('太郎');
  });

  it('PUT で破壊的変更 (カラム削除) は 409 警告、force=true で適用', async () => {
    await request(app).post('/meta/deploy').send(document);
    await request(app).post('/api/customer').send({ name: '太郎', age: 30 });

    const dropAgeBody = {
      name: 'customer',
      label: '顧客',
      fields: [{ name: 'name', label: '氏名', type: 'string', required: true }],
    };

    const conflict = await request(app).put('/meta/models/customer').send(dropAgeBody);
    expect(conflict.status).toBe(409);
    expect(conflict.body.requiresConfirmation).toBe(true);
    expect(Array.isArray(conflict.body.warnings)).toBe(true);
    expect(conflict.body.warnings.length).toBeGreaterThan(0);

    // 確認なしのままだとデータは保持されている
    const list1 = await request(app).get('/api/customer');
    expect(list1.body[0].age).toBe(30);

    // 強制適用
    const forced = await request(app)
      .put('/meta/models/customer?force=true')
      .send(dropAgeBody);
    expect(forced.status).toBe(200);

    const list2 = await request(app).get('/api/customer');
    expect(list2.body[0].age).toBeUndefined();
    expect(list2.body[0].name).toBe('太郎');
  });
});

function composeUrl(db: TestDbHandle): string {
  const raw = process.env.TEST_DATABASE_URL ?? savedDatabaseUrl;
  if (!raw) throw new Error('TEST_DATABASE_URL or DATABASE_URL must be set');
  // search_path を URL の options で指定。pg は URL の options を見てくれる。
  const sep = raw.includes('?') ? '&' : '?';
  return `${raw}${sep}options=${encodeURIComponent(`-c search_path=${db.schema}`)}`;
}
