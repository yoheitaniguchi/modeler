import { test, expect } from '@playwright/test';
import { gotoDesignTab, newApiContext, resetDeployedModels } from './helpers.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import os from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test.describe('画面定義 (UiConfig + ボタン定義) の保存/読込', () => {
  test.beforeEach(async () => {
    const api = await newApiContext();
    await resetDeployedModels(api);
    await api.dispose();
  });

  test('読込→保存ボタンで JSON ダウンロードができる', async ({ page }) => {
    // テスト用 JSON を一時ファイルに書き出す
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'modeler-e2e-'));
    const jsonPath = path.join(tmp, 'fixture.json');
    await fs.writeFile(
      jsonPath,
      JSON.stringify({
        version: 1,
        models: [
          {
            name: 'order',
            label: '注文',
            fields: [{ name: 'status', label: 'ステータス', type: 'string', required: true }],
            ui: {
              buttons: [
                {
                  id: 'do_export',
                  label: 'エクスポート',
                  scope: 'screen',
                  action: { kind: 'http', method: 'GET', url: '/test/echo' },
                },
              ],
            },
          },
        ],
      }),
      'utf-8',
    );

    await gotoDesignTab(page);

    // JSON 読込
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByTestId('load-json').click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(jsonPath);

    await expect(page.locator('.notice')).toContainText('JSON を読み込みました');
    await expect(page.locator('input[value="order"]')).toBeVisible();
    await expect(page.locator('input[value="注文"]')).toBeVisible();
    // ボタン定義が復元されているか (ButtonsEditor 内に行が出る)
    // 詳細セクション (details) を開く
    await page.getByText('カスタムボタン').click();
    await expect(page.locator('input[value="do_export"]')).toBeVisible();
    await expect(page.locator('input[value="エクスポート"]')).toBeVisible();

    // JSON 保存
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('save-json').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('model-definition.json');

    await fs.rm(tmp, { recursive: true, force: true });
  });
});
