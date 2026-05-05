import { test, expect } from '@playwright/test';
import { gotoDeployedTab, newApiContext, resetDeployedModels } from './helpers.js';

test.describe('カスタムボタン (REST API 呼び出し)', () => {
  test.beforeEach(async () => {
    const api = await newApiContext();
    await resetDeployedModels(api);
    // ボタン定義を含むモデルをデプロイ
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
            ],
            ui: {
              buttons: [
                {
                  id: 'echo_screen',
                  label: '画面ボタン',
                  scope: 'screen',
                  style: 'primary',
                  action: { kind: 'http', method: 'POST', url: '/test/echo', bodyTemplate: '{"hello":"world"}' },
                },
                {
                  id: 'echo_row',
                  label: '行ボタン',
                  scope: 'row',
                  style: 'ghost',
                  action: { kind: 'http', method: 'POST', url: '/test/echo', bodyTemplate: '{"id":"{{id}}","name":"{{name}}"}' },
                },
              ],
            },
          },
        ],
      },
    });
    await api.post('http://localhost:4000/api/customer', { data: { name: 'Alice', age: 30 } });
    await api.dispose();
  });

  test('画面ボタンを押すと成功通知が出る', async ({ page }) => {
    await gotoDeployedTab(page);
    await page.getByTestId('model-select').selectOption('customer');
    await page.getByTestId('screen-button-echo_screen').click();
    await expect(page.locator('.notice')).toContainText('画面ボタン');
  });

  test('行ボタンが行ごとに表示され、押下できる', async ({ page }) => {
    await gotoDeployedTab(page);
    await page.getByTestId('model-select').selectOption('customer');
    // テストID は row-button-{id}-{recordId} で動的だが、表記の "行ボタン" でも取得可能
    await page.getByRole('button', { name: '行ボタン' }).click();
    await expect(page.locator('.notice')).toContainText('行ボタン');
  });
});
