import { request, type APIRequestContext, type Page } from '@playwright/test';

/**
 * 各テスト前にサーバー状態 (デプロイ済みモデル + データファイル) を完全クリア。
 * /test/reset を使うことで前テストのレコードが次テストに混じらない。
 */
export async function resetDeployedModels(api: APIRequestContext) {
  await api.post('http://localhost:4000/test/reset');
}

export async function newApiContext(): Promise<APIRequestContext> {
  return await request.newContext();
}

/** 「設計タブ」をアクティブにする。 */
export async function gotoDesignTab(page: Page) {
  await page.goto('/');
  // SPA の bootstrap が終わってタブが見えるまで待つ
  const tab = page.getByRole('tab', { name: /モデル設計/ });
  await tab.waitFor({ state: 'visible' });
  await tab.click();
}

export async function gotoDeployedTab(page: Page) {
  await page.goto('/');
  const tab = page.getByRole('tab', { name: /デプロイ済みモデル/ });
  await tab.waitFor({ state: 'visible' });
  await tab.click();
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
