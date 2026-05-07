import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ModelDefinitionDocument } from '@modeler/shared';
import { createApp } from './app.js';

/**
 * 一括インポート / エクスポート API テスト。
 * app.test.ts と同様のパターン: 実際の Express + JsonFileDao を使う。
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
        { name: 'active', label: '有効', type: 'boolean', required: false },
      ],
    },
  ],
};

describe('一括インポート / エクスポート API', () => {
  let dataDir: string;
  let app: ReturnType<typeof createApp>['app'];

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'modeler-bulk-'));
    app = createApp({ dataDir }).app;
    // customer モデルをデプロイ
    await request(app).post('/meta/deploy').send(document);
  });

  afterEach(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // エクスポート
  // ──────────────────────────────────────────────────────────────────────────
  describe('GET /api/customer/export', () => {
    it('空のレコードでも CSV をダウンロードできる', async () => {
      const res = await request(app).get('/api/customer/export?format=csv');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/csv/);
      // ヘッダ行だけ
      expect(res.text).toContain('name,age,active');
    });

    it('TSV フォーマットでエクスポートできる', async () => {
      // データを 1 件作成
      await request(app).post('/api/customer').send({ name: 'Alice', age: 30, active: true });
      const res = await request(app).get('/api/customer/export?format=tsv');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/tab-separated/);
      expect(res.text).toContain('name\tage\tactive');
      expect(res.text).toContain('Alice');
      // ファイル名が {modelName}-{yyyymmdd}-{hhmmss}.tsv 形式になっている
      const cd = res.headers['content-disposition'] as string;
      expect(cd).toMatch(/filename="customer-\d{8}-\d{6}\.tsv"/);
    });

    it('JSON フォーマットでエクスポートできる', async () => {
      await request(app).post('/api/customer').send({ name: 'Bob', age: 25 });
      const res = await request(app).get('/api/customer/export?format=json');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      const data = JSON.parse(res.text) as { name: string }[];
      expect(data[0].name).toBe('Bob');
      // ファイル名が {modelName}-{yyyymmdd}-{hhmmss}.json 形式になっている
      const cd = res.headers['content-disposition'] as string;
      expect(cd).toMatch(/filename="customer-\d{8}-\d{6}\.json"/);
    });

    it('不正なフォーマットは 400 を返す', async () => {
      const res = await request(app).get('/api/customer/export?format=xml');
      expect(res.status).toBe(400);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // インポート
  // ──────────────────────────────────────────────────────────────────────────
  describe('POST /api/customer/import', () => {
    it('正常な CSV をインポートできる', async () => {
      const csv = 'name,age,active\nAlice,30,true\nBob,25,false';
      const res = await request(app)
        .post('/api/customer/import')
        .field('format', 'csv')
        .attach('file', Buffer.from(csv), { filename: 'data.csv', contentType: 'text/csv' });
      expect(res.status).toBe(201);
      expect(res.body.imported).toBe(2);

      // 一覧で確認
      const list = await request(app).get('/api/customer');
      expect(list.body).toHaveLength(2);
    });

    it('正常な TSV をインポートできる', async () => {
      const tsv = 'name\tage\tactive\nCharlie\t22\ttrue';
      const res = await request(app)
        .post('/api/customer/import')
        .field('format', 'tsv')
        .attach('file', Buffer.from(tsv), { filename: 'data.tsv', contentType: 'text/plain' });
      expect(res.status).toBe(201);
      expect(res.body.imported).toBe(1);
    });

    it('正常な JSON をインポートできる', async () => {
      const json = JSON.stringify([{ name: 'Dave', age: 35, active: false }]);
      const res = await request(app)
        .post('/api/customer/import')
        .field('format', 'json')
        .attach('file', Buffer.from(json), {
          filename: 'data.json',
          contentType: 'application/json',
        });
      expect(res.status).toBe(201);
      expect(res.body.imported).toBe(1);
    });

    it('required 違反の行がある場合 422 とエラー行情報を返す', async () => {
      const csv = 'name,age,active\n,30,true\nEve,25,false';
      const res = await request(app)
        .post('/api/customer/import')
        .field('format', 'csv')
        .attach('file', Buffer.from(csv), { filename: 'bad.csv', contentType: 'text/csv' });
      expect(res.status).toBe(422);
      expect(res.body.rowErrors).toBeDefined();
      expect(res.body.rowErrors.length).toBeGreaterThan(0);
      expect(res.body.rowErrors[0].row).toBe(1);
      expect(res.body.rowErrors[0].field).toBe('name');
      // エラーログが TSV 形式で含まれる
      expect(res.body.errorLog).toContain('行番号');
    });

    it('ファイルなしは 400', async () => {
      const res = await request(app)
        .post('/api/customer/import')
        .field('format', 'csv');
      expect(res.status).toBe(400);
    });

    it('不正フォーマットは 400', async () => {
      const csv = 'name\nAlice';
      const res = await request(app)
        .post('/api/customer/import')
        .field('format', 'xml')
        .attach('file', Buffer.from(csv), { filename: 'data.csv', contentType: 'text/csv' });
      expect(res.status).toBe(400);
    });

    it('JSON がオブジェクトのときは 422 でパースエラーを返す', async () => {
      const json = JSON.stringify({ name: 'bad' });
      const res = await request(app)
        .post('/api/customer/import')
        .field('format', 'json')
        .attach('file', Buffer.from(json), {
          filename: 'bad.json',
          contentType: 'application/json',
        });
      expect(res.status).toBe(422);
      expect(res.body.parseError).toBeTruthy();
    });
  });
});
