import { test, expect } from '@playwright/test';
import { newApiContext, resetDeployedModels } from './helpers.js';

/**
 * UI を介さない、サーバー API レベルの E2E。
 * 検索/インライン編集/カスタムボタンとは独立したサニティテスト。
 */
test.describe('Server API の sanity check', () => {
  test.beforeEach(async () => {
    const api = await newApiContext();
    await resetDeployedModels(api);
    await api.dispose();
  });

  test('deploy → CRUD → updateModel → CRUD のフロー', async () => {
    const api = await newApiContext();
    await api.post('http://localhost:4000/meta/deploy', {
      data: {
        version: 1,
        models: [
          {
            name: 'product',
            label: '商品',
            fields: [{ name: 'title', label: '名称', type: 'string', required: true }],
          },
        ],
      },
    });

    const created = await api.post('http://localhost:4000/api/product', { data: { title: 'A' } });
    expect(created.status()).toBe(201);
    const body = await created.json();

    // フィールド追加
    const upd = await api.put('http://localhost:4000/meta/models/product', {
      data: {
        name: 'product',
        label: '商品 v2',
        fields: [
          { name: 'title', label: '名称', type: 'string', required: true },
          { name: 'price', label: '価格', type: 'number', required: false },
        ],
      },
    });
    expect(upd.status()).toBe(200);

    // 既存データが残っている
    const got = await api.get(`http://localhost:4000/api/product/${body.id}`);
    expect(got.status()).toBe(200);
    expect((await got.json()).title).toBe('A');

    // 削除
    const del = await api.delete('http://localhost:4000/meta/models/product');
    expect(del.status()).toBe(204);

    await api.dispose();
  });
});
