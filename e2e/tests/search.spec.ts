import { test, expect } from '@playwright/test';
import { deployCustomer, gotoDeployedTab, newApiContext, resetDeployedModels } from './helpers.js';

test.describe('検索/フィルタ/ソート', () => {
  test.beforeEach(async () => {
    const api = await newApiContext();
    await resetDeployedModels(api);
    await deployCustomer(api);
    // 5 件作成
    for (const r of [
      { name: 'Alice', age: 30, active: true },
      { name: 'Bob', age: 25, active: false },
      { name: 'Charlie', age: 40, active: true },
      { name: 'David', age: 35, active: true },
      { name: 'Eve', age: 28, active: false },
    ]) {
      await api.post('http://localhost:4000/api/customer', { data: r });
    }
    await api.dispose();
  });

  test('キーワード検索で絞り込める', async ({ page }) => {
    await gotoDeployedTab(page);
    await page.getByTestId('model-select').selectOption('customer');
    await expect(page.getByTestId('hit-count')).toContainText('5 / 5');

    await page.getByTestId('search-keyword').fill('ali');
    await expect(page.getByTestId('hit-count')).toContainText('1 / 5');
    await expect(page.getByRole('cell', { name: 'Alice' })).toBeVisible();
  });

  test('詳細検索 (number ≥) が動く', async ({ page }) => {
    await gotoDeployedTab(page);
    await page.getByTestId('model-select').selectOption('customer');
    await page.getByTestId('toggle-advanced').click();

    // 年齢の行を取得 (label: 年齢)
    const ageRow = page.locator('.filter-row', { hasText: '年齢' });
    await ageRow.getByRole('combobox').selectOption('gte');
    await ageRow.getByRole('spinbutton').fill('30');
    await expect(page.getByTestId('hit-count')).toContainText('3 / 5');
  });

  test('カラムヘッダクリックでソートできる', async ({ page }) => {
    await gotoDeployedTab(page);
    await page.getByTestId('model-select').selectOption('customer');

    // 年齢で昇順
    await page.getByTestId('sort-age').click();
    const firstName = await page.locator('table tbody tr').first().locator('td').first().textContent();
    expect(firstName).toBe('Bob'); // age=25 が最小

    // もう一度クリックで降順
    await page.getByTestId('sort-age').click();
    const firstNameDesc = await page.locator('table tbody tr').first().locator('td').first().textContent();
    expect(firstNameDesc).toBe('Charlie'); // age=40 が最大
  });
});
