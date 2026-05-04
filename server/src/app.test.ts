import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ModelDefinitionDocument } from '@modeler/shared';
import { createApp } from './app.js';

/**
 * E2E に近い API テスト。
 * 「デプロイ → CRUD」がドキュメント通り動くかを通しで確認する。
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

describe('app', () => {
  let dataDir: string;
  let app: ReturnType<typeof createApp>['app'];

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'modeler-app-'));
    app = createApp({ dataDir }).app;
  });

  afterEach(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
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
    const res = await request(app)
      .post('/meta/deploy')
      .send({ version: 99, models: [] });
    expect(res.status).toBe(400);
    expect(res.body.errors.length).toBeGreaterThan(0);
  });

  it('deploy 後に CRUD が一通り動く', async () => {
    // deploy
    const dep = await request(app).post('/meta/deploy').send(document);
    expect(dep.status).toBe(200);

    // list (空)
    expect((await request(app).get('/api/customer')).body).toEqual([]);

    // create
    const created = await request(app)
      .post('/api/customer')
      .send({ name: '山田太郎', age: 30 });
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    // get
    const got = await request(app).get(`/api/customer/${id}`);
    expect(got.status).toBe(200);
    expect(got.body.name).toBe('山田太郎');

    // update
    const upd = await request(app)
      .put(`/api/customer/${id}`)
      .send({ name: '山田次郎', age: 31 });
    expect(upd.status).toBe(200);
    expect(upd.body.name).toBe('山田次郎');

    // required 違反 → 400
    const bad = await request(app)
      .post('/api/customer')
      .send({ age: 99 });
    expect(bad.status).toBe(400);

    // delete
    const del = await request(app).delete(`/api/customer/${id}`);
    expect(del.status).toBe(204);

    // 削除後の get は 404
    const after = await request(app).get(`/api/customer/${id}`);
    expect(after.status).toBe(404);
  });

  it('再 deploy で別モデルに差し替えられる', async () => {
    await request(app).post('/meta/deploy').send(document);

    const next: ModelDefinitionDocument = {
      version: 1,
      models: [
        {
          name: 'product',
          label: '商品',
          fields: [{ name: 'title', label: '名称', type: 'string', required: true }],
        },
      ],
    };
    await request(app).post('/meta/deploy').send(next);

    expect((await request(app).get('/api/product')).status).toBe(200);
    // 差し替わったので旧パスは 404
    expect((await request(app).get('/api/customer')).status).toBe(404);
  });

  it('GET /meta/models で現状を取得できる', async () => {
    await request(app).post('/meta/deploy').send(document);
    const res = await request(app).get('/meta/models');
    expect(res.body.models).toHaveLength(1);
    expect(res.body.models[0].name).toBe('customer');
  });
});
