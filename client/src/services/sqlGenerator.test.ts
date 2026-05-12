import { describe, expect, it } from 'vitest';
import type { ModelDefinition } from '@modeler/shared';
import { buildSqlFilename, generateCreateTable } from './sqlGenerator.js';

const allTypes: ModelDefinition = {
  name: 'sample',
  label: 'サンプル',
  fields: [
    { name: 'name', label: '氏名', type: 'string', required: true },
    { name: 'age', label: '年齢', type: 'number', required: false },
    { name: 'active', label: '有効', type: 'boolean', required: false },
    { name: 'created_at', label: '作成日時', type: 'date', required: false },
  ],
};

describe('generateCreateTable', () => {
  it('PostgreSQL: 4 型のマッピングと NOT NULL を出力', () => {
    const sql = generateCreateTable(allTypes, 'postgresql');
    expect(sql).toBe(
      'CREATE TABLE "sample" (\n' +
        '  "name" TEXT NOT NULL,\n' +
        '  "age" DOUBLE PRECISION,\n' +
        '  "active" BOOLEAN,\n' +
        '  "created_at" TIMESTAMP\n' +
        ');\n',
    );
  });

  it('SQLite: 型マッピングが PG とは異なる', () => {
    const sql = generateCreateTable(allTypes, 'sqlite');
    expect(sql).toContain('"name" TEXT NOT NULL');
    expect(sql).toContain('"age" NUMERIC');
    expect(sql).toContain('"active" INTEGER');
    expect(sql).toContain('"created_at" TEXT');
  });

  it('MS Access: 角括弧クォートと BIT/DOUBLE/DATETIME', () => {
    const sql = generateCreateTable(allTypes, 'msaccess');
    expect(sql).toContain('CREATE TABLE [sample]');
    expect(sql).toContain('[name] TEXT NOT NULL');
    expect(sql).toContain('[age] DOUBLE');
    expect(sql).toContain('[active] BIT');
    expect(sql).toContain('[created_at] DATETIME');
  });

  it('string の defaultValue はシングルクォートでエスケープされる', () => {
    const m: ModelDefinition = {
      name: 't',
      label: 't',
      fields: [{ name: 'n', label: 'n', type: 'string', required: false, defaultValue: "O'Brien" }],
    };
    expect(generateCreateTable(m, 'postgresql')).toContain(`"n" TEXT DEFAULT 'O''Brien'`);
  });

  it('boolean の defaultValue は方言ごとに表記が異なる', () => {
    const m: ModelDefinition = {
      name: 't',
      label: 't',
      fields: [{ name: 'b', label: 'b', type: 'boolean', required: false, defaultValue: true }],
    };
    expect(generateCreateTable(m, 'postgresql')).toContain('DEFAULT TRUE');
    expect(generateCreateTable(m, 'sqlite')).toContain('DEFAULT 1');
    expect(generateCreateTable(m, 'msaccess')).toContain('DEFAULT True');
  });

  it('number の defaultValue は数値リテラルとして埋め込む', () => {
    const m: ModelDefinition = {
      name: 't',
      label: 't',
      fields: [{ name: 'x', label: 'x', type: 'number', required: false, defaultValue: 3.14 }],
    };
    expect(generateCreateTable(m, 'postgresql')).toContain('DEFAULT 3.14');
  });

  it('date の defaultValue: today は方言ごとの日付関数にマッピングされる', () => {
    const m: ModelDefinition = {
      name: 't',
      label: 't',
      fields: [{ name: 'd', label: 'd', type: 'date', required: false, defaultValue: 'today' }],
    };
    expect(generateCreateTable(m, 'postgresql')).toContain('DEFAULT CURRENT_DATE');
    expect(generateCreateTable(m, 'sqlite')).toContain('DEFAULT CURRENT_DATE');
    expect(generateCreateTable(m, 'msaccess')).toContain('DEFAULT Date()');
  });

  it('date の特定の defaultValue はエスケープされて文字列としてマッピングされる', () => {
    const m: ModelDefinition = {
      name: 't',
      label: 't',
      fields: [{ name: 'd', label: 'd', type: 'date', required: false, defaultValue: '2026-05-12' }],
    };
    expect(generateCreateTable(m, 'postgresql')).toContain("DEFAULT '2026-05-12'");
  });

  it('null / undefined / NaN / Infinity は DEFAULT 句を出力しない', () => {
    const m: ModelDefinition = {
      name: 't',
      label: 't',
      fields: [
        { name: 'a', label: 'a', type: 'string', required: false, defaultValue: null },
        { name: 'b', label: 'b', type: 'string', required: false, defaultValue: undefined },
        { name: 'c', label: 'c', type: 'number', required: false, defaultValue: Number.NaN },
        { name: 'd', label: 'd', type: 'number', required: false, defaultValue: Number.POSITIVE_INFINITY },
      ],
    };
    const sql = generateCreateTable(m, 'postgresql');
    expect(sql).not.toContain('DEFAULT');
  });

  it('required + defaultValue を両方持つフィールドは両方出力する', () => {
    const m: ModelDefinition = {
      name: 't',
      label: 't',
      fields: [{ name: 'n', label: 'n', type: 'string', required: true, defaultValue: 'x' }],
    };
    expect(generateCreateTable(m, 'postgresql')).toContain(`"n" TEXT NOT NULL DEFAULT 'x'`);
  });

  it('フィールド 0 件は Error を throw', () => {
    const empty: ModelDefinition = { name: 't', label: 't', fields: [] };
    expect(() => generateCreateTable(empty, 'postgresql')).toThrow(/フィールドが0件/);
  });
});

describe('generateCreateTable foreign keys', () => {
  const modelWithFk: ModelDefinition = {
    name: 'Employee',
    label: '従業員',
    fields: [
      { name: 'name', label: '氏名', type: 'string', required: true },
      {
        name: 'dept',
        label: '部署',
        type: 'reference',
        required: false,
        targetModel: 'Department',
        onDelete: 'cascade',
        onUpdate: 'noAction',
      },
    ],
  };

  it('PostgreSQL: FOREIGN KEY 制約を出力 (ON DELETE CASCADE ON UPDATE NO ACTION)', () => {
    const sql = generateCreateTable(modelWithFk, 'postgresql');
    expect(sql).toContain('"name" TEXT NOT NULL,');
    expect(sql).toContain('"dept" TEXT,');
    expect(sql).toContain(
      'CONSTRAINT "fk_Employee_dept" FOREIGN KEY ("dept") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
  });

  it('SQLite: FOREIGN KEY 制約を出力', () => {
    const sql = generateCreateTable(modelWithFk, 'sqlite');
    expect(sql).toContain(
      'CONSTRAINT "fk_Employee_dept" FOREIGN KEY ("dept") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
  });

  it('MS Access: FOREIGN KEY は出力するが ON DELETE/UPDATE は非対応コメントを残す', () => {
    const sql = generateCreateTable(modelWithFk, 'msaccess');
    expect(sql).toContain('-- ON DELETE/UPDATE not supported in MS Access DDL');
    expect(sql).toContain(
      'CONSTRAINT [fk_Employee_dept] FOREIGN KEY ([dept]) REFERENCES [Department]([id])',
    );
    // CONSTRAINT 行に ON DELETE / ON UPDATE 句が含まれないこと (コメント行は除外)
    const ddlLines = sql.split('\n').filter((l) => !l.trimStart().startsWith('--'));
    const ddl = ddlLines.join('\n');
    expect(ddl).not.toContain('ON DELETE');
    expect(ddl).not.toContain('ON UPDATE');
  });

  it('onDelete / onUpdate 未指定は restrict / noAction にフォールバック', () => {
    const m: ModelDefinition = {
      name: 'Employee',
      label: 'e',
      fields: [
        { name: 'name', label: 'n', type: 'string', required: true },
        {
          name: 'dept',
          label: 'd',
          type: 'reference',
          required: false,
          targetModel: 'Department',
        },
      ],
    };
    const sql = generateCreateTable(m, 'postgresql');
    expect(sql).toContain('ON DELETE RESTRICT ON UPDATE NO ACTION');
  });

  it('onDelete=setNull は SET NULL を出力', () => {
    const m: ModelDefinition = {
      name: 'Employee',
      label: 'e',
      fields: [
        { name: 'name', label: 'n', type: 'string', required: true },
        {
          name: 'dept',
          label: 'd',
          type: 'reference',
          required: false,
          targetModel: 'Department',
          onDelete: 'setNull',
        },
      ],
    };
    expect(generateCreateTable(m, 'postgresql')).toContain('ON DELETE SET NULL');
  });

  it('targetModel 未指定の reference は FK 制約を出さない', () => {
    const m: ModelDefinition = {
      name: 't',
      label: 't',
      fields: [
        { name: 'name', label: 'n', type: 'string', required: true },
        { name: 'ref', label: 'r', type: 'reference', required: false },
      ],
    };
    const sql = generateCreateTable(m, 'postgresql');
    expect(sql).not.toContain('CONSTRAINT');
    expect(sql).not.toContain('FOREIGN KEY');
  });

  it('複数 FK と非 FK 列が混在しても最終行のみカンマなしで生成される', () => {
    const m: ModelDefinition = {
      name: 'OrderLine',
      label: 'ol',
      fields: [
        { name: 'qty', label: 'q', type: 'number', required: true },
        {
          name: 'order',
          label: 'o',
          type: 'reference',
          required: true,
          targetModel: 'Order',
        },
        {
          name: 'product',
          label: 'p',
          type: 'reference',
          required: true,
          targetModel: 'Product',
          onDelete: 'cascade',
        },
      ],
    };
    const sql = generateCreateTable(m, 'postgresql');
    // 最終 FK 行の末尾にカンマがないこと
    expect(sql).toMatch(/ON UPDATE NO ACTION\n\);\n$/);
    // 1 つ目の FK 行末にはカンマがあること
    expect(sql).toContain(
      'CONSTRAINT "fk_OrderLine_order" FOREIGN KEY ("order") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,',
    );
  });
});

describe('buildSqlFilename', () => {
  it('指定の Date からゼロ詰めしたタイムスタンプ付きファイル名を作る', () => {
    const fixed = new Date(2026, 4, 6, 9, 7, 5);
    expect(buildSqlFilename('customer', 'postgresql', fixed)).toBe(
      'customer-20260506-090705-postgresql.sql',
    );
    expect(buildSqlFilename('order', 'sqlite', fixed)).toBe('order-20260506-090705-sqlite.sql');
    expect(buildSqlFilename('order', 'msaccess', fixed)).toBe('order-20260506-090705-msaccess.sql');
  });
});
