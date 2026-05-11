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

/** 管理者モードに遷移する (サイドバー最上部のトグル)。 */
export async function gotoAdminMode(page: Page) {
  await page.goto('/');
  const btn = page.getByTestId('mode-admin');
  await btn.waitFor({ state: 'visible' });
  await btn.click();
}

/** ユーザーモード (マスター管理) に遷移し、サイドバーのモデルリストが読み込まれるまで待つ。 */
export async function gotoUserMode(page: Page) {
  await page.goto('/');
  const btn = page.getByTestId('mode-user');
  await btn.waitFor({ state: 'visible' });
  await btn.click();
  await page.getByTestId('deployed-model-list').waitFor({ state: 'visible' });
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
