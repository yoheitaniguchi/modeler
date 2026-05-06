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

  it('DELETE /meta/models/:name で model を削除できる', async () => {
    // deploy
    await request(app).post('/meta/deploy').send(document);
    expect((await request(app).get('/meta/models')).body.models).toHaveLength(1);

    // delete
    const del = await request(app).delete('/meta/models/customer');
    expect(del.status).toBe(204);

    // その後 get は 404
    expect((await request(app).get('/api/customer')).status).toBe(404);

    // /meta/models にも含まれない
    expect((await request(app).get('/meta/models')).body.models).toHaveLength(0);
  });

  it('DELETE で存在しないモデル指定は 404', async () => {
    const res = await request(app).delete('/meta/models/nonexistent');
    expect(res.status).toBe(404);
  });

  it('PUT /meta/models/:name でフィールド追加した再デプロイができ、データは保持', async () => {
    await request(app).post('/meta/deploy').send(document);
    // create some data
    const created = await request(app)
      .post('/api/customer')
      .send({ name: '太郎', age: 30 });
    const id = created.body.id as string;

    // update model: 新フィールド `email` (optional) を追加
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

    // データは残っているはず
    const got = await request(app).get(`/api/customer/${id}`);
    expect(got.status).toBe(200);
    expect(got.body.name).toBe('太郎');

    // /meta/models にも新ラベルが反映
    const list = await request(app).get('/meta/models');
    expect(list.body.models[0].label).toBe('顧客 v2');
    expect(list.body.models[0].fields).toHaveLength(3);
  });

  it('PUT /meta/models/:name で path と body の name 不一致は 400', async () => {
    await request(app).post('/meta/deploy').send(document);
    const res = await request(app).put('/meta/models/customer').send({
      name: 'product',
      label: 'X',
      fields: [{ name: 'a', label: 'A', type: 'string', required: true }],
    });
    expect(res.status).toBe(400);
  });

  it('PUT で存在しないモデルは 404', async () => {
    const res = await request(app).put('/meta/models/nonexistent').send(document.models[0]);
    expect(res.status).toBe(404);
  });

  it('PUT で不正なモデル定義は 400', async () => {
    await request(app).post('/meta/deploy').send(document);
    const res = await request(app).put('/meta/models/customer').send({
      name: 'customer',
      label: '',
      fields: [],
    });
    expect(res.status).toBe(400);
    expect(res.body.errors.length).toBeGreaterThan(0);
  });

  it('/test/echo は POST/GET 両方とも動く (E2E ヘルパ用)', async () => {
    const p = await request(app).post('/test/echo').send({ hello: 'world' });
    expect(p.status).toBe(200);
    expect(p.body.method).toBe('POST');
    expect(p.body.body).toEqual({ hello: 'world' });

    const g = await request(app).get('/test/echo?x=1');
    expect(g.status).toBe(200);
    expect(g.body.method).toBe('GET');
    expect(g.body.query).toEqual({ x: '1' });
  });

  it('DELETE 後もデータファイルは残る', async () => {
    // deploy して create
    await request(app).post('/meta/deploy').send(document);
    await request(app).post('/api/customer').send({ name: '太郎', age: 30 });

    // delete model
    await request(app).delete('/meta/models/customer');

    // ファイルがまだあることを確認（dataDir を見てチェック）
    const file = await fs.stat(path.join(dataDir, 'customer.json'));
    expect(file.isFile()).toBe(true);
  });
});
