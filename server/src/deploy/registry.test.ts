import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ModelDefinitionDocument } from '@modeler/shared';
import { DeployRegistry, DestructiveChangeError } from './registry.js';
import { createTestDb, TEST_DB_AVAILABLE, type TestDbHandle } from '../dao/testDb.js';
import { closePool } from '../db/pool.js';

const doc: ModelDefinitionDocument = {
  version: 1,
  models: [
    {
      name: 'department',
      label: '部署',
      fields: [{ name: 'name', label: '名称', type: 'string', required: true }],
    },
    {
      name: 'employee',
      label: '従業員',
      fields: [
        { name: 'name', label: '氏名', type: 'string', required: true },
        {
          name: 'dept',
          label: '部署',
          type: 'reference',
          required: false,
          targetModel: 'department',
        },
      ],
    },
  ],
};

let savedDatabaseUrl: string | undefined;

describe.skipIf(!TEST_DB_AVAILABLE)('DeployRegistry — DAO レジストリ配線', () => {
  let db: TestDbHandle;
  let registry: DeployRegistry;

  beforeAll(() => {
    savedDatabaseUrl = process.env.DATABASE_URL;
  });

  afterAll(async () => {
    if (savedDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = savedDatabaseUrl;
    await closePool();
  });

  beforeEach(async () => {
    db = await createTestDb();
    process.env.DATABASE_URL = composeUrl(db);
    await closePool();
    registry = new DeployRegistry();
  });

  afterEach(async () => {
    await closePool();
    await db.cleanup();
  });

  it('deploy 後に getDao で各モデルの DAO が引ける', async () => {
    await registry.deploy(doc);
    expect(registry.getDao('department')).toBeDefined();
    expect(registry.getDao('employee')).toBeDefined();
    expect(registry.getDao('unknown')).toBeUndefined();
  });

  it('各 DAO に DaoRegistry が注入され、相互に参照できる', async () => {
    await registry.deploy(doc);
    const empDao = registry.getDao('employee')!;
    const dept = await registry.getDao('department')!.create({ name: 'sales' });
    const emp = await empDao.create({ name: 'Alice', dept: dept.id });
    expect(emp.dept).toBe(dept.id);
  });

  it('updateModel で破壊的変更があると DestructiveChangeError', async () => {
    await registry.deploy(doc);
    await registry.getDao('employee')!.create({ name: 'A' });
    // 破壊的変更: 必須カラム追加 (空でないテーブル)
    const updated = {
      ...doc.models[1],
      fields: [
        ...doc.models[1].fields,
        { name: 'email', label: 'メール', type: 'string' as const, required: true },
      ],
    };
    await expect(registry.updateModel('employee', updated)).rejects.toBeInstanceOf(DestructiveChangeError);
  });

  it('updateModel に force=true なら破壊的変更も適用', async () => {
    await registry.deploy(doc);
    // department にレコードを 1 件作って、それから列を消す
    await registry.getDao('department')!.create({ name: 'sales' });
    const updated = {
      ...doc.models[0],
      fields: [], // name 列を消す — 空でないテーブルへの破壊的変更
    };
    // バリデーション: fields は最低 1 つ必要 — 別の破壊的変更で試す
    const dropAge = {
      ...doc.models[1],
      fields: doc.models[1].fields.filter((f) => f.name !== 'dept'),
    };
    await registry.getDao('employee')!.create({ name: 'X' });
    await expect(registry.updateModel('employee', dropAge)).rejects.toBeInstanceOf(DestructiveChangeError);
    const ok = await registry.updateModel('employee', dropAge, { force: true });
    expect(ok).not.toBeNull();
  });

  it('removeModel 後は対象 DAO が引けなくなる', async () => {
    await registry.deploy(doc);
    expect(registry.getDao('employee')).toBeDefined();
    const result = await registry.removeModel('employee');
    expect(result?.ok).toBe(true);
    expect(registry.getDao('employee')).toBeUndefined();
    expect(registry.getDao('department')).toBeDefined();
  });
});

function composeUrl(db: TestDbHandle): string {
  const raw = process.env.TEST_DATABASE_URL ?? savedDatabaseUrl;
  if (!raw) throw new Error('TEST_DATABASE_URL or DATABASE_URL must be set');
  const sep = raw.includes('?') ? '&' : '?';
  return `${raw}${sep}options=${encodeURIComponent(`-c search_path=${db.schema}`)}`;
}
