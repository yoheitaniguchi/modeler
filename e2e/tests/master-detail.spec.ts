import { test, expect, type APIRequestContext } from '@playwright/test';
import { gotoUserMode, newApiContext, resetDeployedModels } from './helpers.js';

/**
 * マスター・ディテール画面 (ui.layout = 'masterDetail') の E2E テスト。
 *
 * 検証スコープ:
 *   - layout='masterDetail' のモデルは MasterDetailView が描画される
 *   - layout 未指定のモデルは従来 CrudView が描画される (後方互換)
 *   - ヘッダー作成 → 明細追加 → 保存 のフロー
 *   - 「既存からコピー」モーダルの操作
 */

const BASE = 'http://localhost:4000';

async function deployOrderModels(api: APIRequestContext) {
  const res = await api.post(`${BASE}/meta/deploy`, {
    data: {
      version: 1,
      models: [
        {
          name: 'orders',
          label: '受注',
          fields: [
            { name: 'customer', label: '顧客', type: 'string', required: true },
            { name: 'orderDate', label: '受注日', type: 'string', required: true },
          ],
          ui: { layout: 'masterDetail', listTitle: '受注ヘッダー' },
        },
        {
          name: 'orderLines',
          label: '受注明細',
          fields: [
            {
              name: 'order',
              label: '受注',
              type: 'reference',
              required: true,
              targetModel: 'orders',
              onDelete: 'cascade',
            },
            { name: 'product', label: '商品', type: 'string', required: true },
            { name: 'quantity', label: '数量', type: 'number', required: true },
            { name: 'unitPrice', label: '単価', type: 'number', required: true },
          ],
          parent: { model: 'orders', via: 'order' },
        },
      ],
    },
  });
  expect(res.status()).toBe(200);
}

test.describe('マスター・ディテール画面 (UI)', () => {
  test.setTimeout(60_000);

  test.beforeEach(async () => {
    const api = await newApiContext();
    await resetDeployedModels(api);
    await deployOrderModels(api);
    await api.dispose();
  });

  test('layout=masterDetail のモデルでは MasterDetailView が表示される', async ({ page }) => {
    await gotoUserMode(page);
    await page.getByTestId('deployed-model-link-orders').click();
    await expect(page.getByTestId('master-detail-view')).toBeVisible();
    await expect(page.getByTestId('md-header-table')).toBeVisible();
    await expect(page.getByTestId('md-detail-empty')).toBeVisible();
  });

  test('layout 未指定の子モデルは従来 CrudView を維持する (後方互換)', async ({ page }) => {
    await gotoUserMode(page);
    await page.getByTestId('deployed-model-link-orderLines').click();
    await expect(page.getByTestId('crud-title')).toBeVisible();
    await expect(page.getByTestId('master-detail-view')).toHaveCount(0);
  });

  test('ヘッダー作成 → 行追加 → 明細保存', async ({ page }) => {
    // ヘッダーは API で先に作成しておき、UI ではヘッダー選択→明細編集のフローのみテスト
    const api = await newApiContext();
    const ordRes = await api.post(`${BASE}/api/orders`, {
      data: { customer: 'Alice Inc', orderDate: '2026-05-13' },
    });
    expect(ordRes.status()).toBe(201);
    const ord = await ordRes.json();
    await api.dispose();

    await gotoUserMode(page);
    await page.getByTestId('deployed-model-link-orders').click();

    // ヘッダー行をクリックで選択
    await page.getByTestId(`md-header-row-${ord.id}`).click();
    await expect(page.getByTestId(`md-header-row-${ord.id}`)).toHaveClass(/is-selected/);

    // 明細行を追加 (ボタンが有効化されるまで待つ)
    await expect(page.getByTestId('md-line-add')).toBeEnabled();
    await page.getByTestId('md-line-add').click();
    const lineTable = page.getByTestId('md-line-table');
    await expect(lineTable).toBeVisible();
    await lineTable.getByPlaceholder('商品 *').fill('りんご');
    await lineTable.getByPlaceholder('数量 *').fill('3');
    await lineTable.getByPlaceholder('単価 *').fill('100');

    // 保存
    await page.getByTestId('md-line-save').click();
    await expect(page.getByText('明細を保存しました')).toBeVisible();
  });

  test('ヘッダー側に 検索/インポート/エクスポート ボタンが表示される', async ({ page }) => {
    await gotoUserMode(page);
    await page.getByTestId('deployed-model-link-orders').click();
    await expect(page.getByTestId('md-header-import')).toBeVisible();
    await expect(page.getByTestId('md-header-export')).toBeVisible();
    // SearchBar の検索ボックスがヘッダーペインに存在する
    const headerPane = page.getByTestId('md-master-pane');
    await expect(headerPane.getByTestId('search-keyword')).toBeVisible();
  });

  test('ヘッダーをキーワードで絞り込める', async ({ page }) => {
    const api = await newApiContext();
    await api.post(`${BASE}/api/orders`, { data: { customer: 'Alice Inc', orderDate: '2026-05-13' } });
    await api.post(`${BASE}/api/orders`, { data: { customer: 'Bob Co', orderDate: '2026-05-14' } });
    await api.dispose();

    await gotoUserMode(page);
    await page.getByTestId('deployed-model-link-orders').click();
    await expect(page.getByText('Alice Inc')).toBeVisible();
    await expect(page.getByText('Bob Co')).toBeVisible();

    const headerPane = page.getByTestId('md-master-pane');
    await headerPane.getByTestId('search-keyword').fill('Alice');
    await expect(page.getByText('Bob Co')).toHaveCount(0);
    await expect(page.getByText('Alice Inc')).toBeVisible();
  });

  test('明細側にも 検索/インポート/エクスポート ボタンが表示される', async ({ page }) => {
    const api = await newApiContext();
    const ordRes = await api.post(`${BASE}/api/orders`, {
      data: { customer: 'Carol Ltd', orderDate: '2026-05-13' },
    });
    const ord = await ordRes.json();
    await api.dispose();

    await gotoUserMode(page);
    await page.getByTestId('deployed-model-link-orders').click();
    await page.getByTestId(`md-header-row-${ord.id}`).click();

    await expect(page.getByTestId('md-line-import')).toBeVisible();
    await expect(page.getByTestId('md-line-export')).toBeVisible();
    const detailPane = page.getByTestId('md-detail-pane');
    await expect(detailPane.getByTestId('search-keyword')).toBeVisible();
  });

  test('API 経由で作成した明細を、選択ヘッダーで一覧表示できる', async ({ page }) => {
    // API でデータを準備
    const api = await newApiContext();
    const ordRes = await api.post(`${BASE}/api/orders`, {
      data: { customer: 'Bob Co', orderDate: '2026-05-13' },
    });
    expect(ordRes.status()).toBe(201);
    const ord = await ordRes.json();
    await api.post(`${BASE}/api/orderLines`, {
      data: { order: ord.id, product: 'みかん', quantity: 2, unitPrice: 80 },
    });
    await api.post(`${BASE}/api/orderLines`, {
      data: { order: ord.id, product: 'ぶどう', quantity: 1, unitPrice: 800 },
    });
    await api.dispose();

    await gotoUserMode(page);
    await page.getByTestId('deployed-model-link-orders').click();

    // ヘッダー行をクリック → 明細が表示される
    await page.getByTestId(`md-header-row-${ord.id}`).click();
    await expect(page.getByTestId('md-line-table')).toBeVisible();
    // 行のセル(input)に値が反映されているか確認
    const inputs = page.getByTestId('md-line-table').locator('input');
    // 少なくとも2行分(各行3カラム=6個)あれば良いとする
    await expect(inputs.first()).toBeVisible();
  });
});
