import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ModelDefinition } from '@modeler/shared';
import { DaoValidationError, JsonFileDao } from './jsonFileDao.js';

/**
 * DAO のテスト方針:
 *   - 一時ディレクトリで実ファイルを使う。これは direction.xml の意図
 *     「環境が正しく構築されたか」を担保するため。モックで誤魔化さない。
 *   - 各テストの前後で隔離する。
 */

const model: ModelDefinition = {
  name: 'item',
  label: '商品',
  fields: [
    { name: 'name', label: '名称', type: 'string', required: true },
    { name: 'price', label: '価格', type: 'number', required: true },
    { name: 'note', label: '備考', type: 'string', required: false },
  ],
};

describe('JsonFileDao', () => {
  let dataDir: string;
  let dao: JsonFileDao;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'modeler-dao-'));
    dao = new JsonFileDao(model, dataDir);
    await dao.init();
  });

  afterEach(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('init で空配列の JSON ファイルが作られる', async () => {
    const list = await dao.list();
    expect(list).toEqual([]);
  });

  it('create + list で 1 件取れる', async () => {
    const created = await dao.create({ name: 'apple', price: 100 });
    expect(created.id).toBeTypeOf('string');
    expect(await dao.list()).toHaveLength(1);
  });

  it('required を満たさないと DaoValidationError', async () => {
    await expect(dao.create({ price: 100 })).rejects.toBeInstanceOf(DaoValidationError);
  });

  it('update は id を保持したまま値を差し替える', async () => {
    const created = await dao.create({ name: 'apple', price: 100 });
    const updated = await dao.update(created.id, { name: 'apple', price: 120 });
    expect(updated?.id).toBe(created.id);
    expect(updated?.price).toBe(120);
  });

  it('存在しない id の update は null', async () => {
    expect(await dao.update('missing', { name: 'a', price: 1 })).toBeNull();
  });

  it('remove で消える / もう一度 remove は false', async () => {
    const created = await dao.create({ name: 'apple', price: 100 });
    expect(await dao.remove(created.id)).toBe(true);
    expect(await dao.remove(created.id)).toBe(false);
  });

  it('並行 create が競合せず全件保存される (直列化の検証)', async () => {
    // 同期的に Promise を 5 つ作る = ほぼ同時発火。
    // ファイルロックがないと最後の write しか残らないバグが出やすい箇所。
    await Promise.all(
      Array.from({ length: 5 }).map((_, i) =>
        dao.create({ name: `item-${i}`, price: i }),
      ),
    );
    const list = await dao.list();
    expect(list).toHaveLength(5);
  });
});
