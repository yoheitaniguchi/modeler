import { request, type APIRequestContext, type Page } from '@playwright/test';

/**
 * 各テスト前にデプロイ済みモデルをすべて削除して状態をリセット。
 * データファイル (.e2e-data/*.json) は残るが、API ルートが消えるので影響なし。
 */
export async function resetDeployedModels(api: APIRequestContext) {
  const res = await api.get('http://localhost:4000/meta/models');
  if (!res.ok()) return;
  const body = await res.json();
  for (const m of body.models ?? []) {
    await api.delete(`http://localhost:4000/meta/models/${m.name}`);
  }
}

export async function newApiContext(): Promise<APIRequestContext> {
  return await request.newContext();
}

/** 「設計タブ」をアクティブにする。 */
export async function gotoDesignTab(page: Page) {
  await page.goto('/');
  await page.getByRole('tab', { name: /モデル設計/ }).click();
}

export async function gotoDeployedTab(page: Page) {
  await page.goto('/');
  await page.getByRole('tab', { name: /デプロイ済みモデル/ }).click();
}

/**
 * 1 つのモデル (customer) を素早く作成→デプロイするヘルパ。
 * UI 経由ではなく直接 API を叩く (テストの本筋ではないため高速化)。
 */
export async function deployCustomer(api: APIRequestContext) {
  await api.post('http://localhost:4000/meta/deploy', {
    data: {
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
    },
  });
}
