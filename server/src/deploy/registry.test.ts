import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ModelDefinitionDocument } from '@modeler/shared';
import { DeployRegistry } from './registry.js';

/**
 * DeployRegistry の DAO 配線まわり (Task 5) の単体テスト。
 * 整合性チェック自体の動作は Task 6 で jsonFileDao.test.ts に追加する。
 */

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

describe('DeployRegistry — DAO レジストリ配線', () => {
  let dataDir: string;
  let registry: DeployRegistry;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'modeler-reg-'));
    registry = new DeployRegistry();
  });

  afterEach(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('deploy 後に getDao で各モデルの DAO が引ける', async () => {
    await registry.deploy(doc, dataDir);
    expect(registry.getDao('department')).toBeDefined();
    expect(registry.getDao('employee')).toBeDefined();
    expect(registry.getDao('unknown')).toBeUndefined();
  });

  it('各 DAO に DaoRegistry が注入され、相互に他 DAO を参照できる', async () => {
    await registry.deploy(doc, dataDir);
    const empDao = registry.getDao('employee')!;
    // private を覗き見るのは避けつつ、registry 経由で他 DAO が引けることを実証する
    // ため Department を 1 件作成 → Employee から参照可能 (存在 ID として認識される)
    const dept = await registry.getDao('department')!.create({ name: 'sales' });
    const found = await empDao.create({ name: 'Alice', dept: dept.id });
    expect(found.dept).toBe(dept.id);
  });

  it('updateModel 後も DAO レジストリは再配線される', async () => {
    await registry.deploy(doc, dataDir);
    const empOld = registry.getDao('employee');
    expect(empOld).toBeDefined();
    const updated = {
      ...doc.models[1],
      label: '従業員(改)',
    };
    await registry.updateModel('employee', updated, dataDir);
    const empNew = registry.getDao('employee');
    expect(empNew).toBeDefined();
    // 同じ参照とは限らない (新しい DAO に差し替わる) が、必ず存在すること
  });

  it('removeModel 後は対象 DAO が引けなくなる', async () => {
    await registry.deploy(doc, dataDir);
    expect(registry.getDao('employee')).toBeDefined();
    registry.removeModel('employee');
    expect(registry.getDao('employee')).toBeUndefined();
    expect(registry.getDao('department')).toBeDefined();
  });
});
