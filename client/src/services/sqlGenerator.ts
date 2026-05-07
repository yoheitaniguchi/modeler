import type { FieldDefinition, FieldType, ModelDefinition } from '@modeler/shared';

/**
 * モデル定義から各 DBMS 向けの CREATE TABLE 文を生成する純粋関数群。
 *
 * 対応方言は PostgreSQL / SQLite / MS Access の 3 種類。
 * 主キーやインデックスはモデル定義側に概念が無いため出力しない。
 * 出力するのは「列名 / 型 / NOT NULL / DEFAULT」のみ。
 */

export type SqlDialect = 'postgresql' | 'sqlite' | 'msaccess';

const TYPE_MAP: Record<SqlDialect, Record<FieldType, string>> = {
  postgresql: {
    string: 'TEXT',
    number: 'DOUBLE PRECISION',
    boolean: 'BOOLEAN',
    date: 'TIMESTAMP',
    reference: 'TEXT',
  },
  sqlite: {
    string: 'TEXT',
    number: 'NUMERIC',
    boolean: 'INTEGER',
    date: 'TEXT',
    reference: 'TEXT',
  },
  msaccess: {
    string: 'TEXT',
    number: 'DOUBLE',
    boolean: 'BIT',
    date: 'DATETIME',
    reference: 'TEXT',
  },
};

function quoteIdentifier(name: string, dialect: SqlDialect): string {
  return dialect === 'msaccess' ? `[${name}]` : `"${name}"`;
}

function quoteSqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function formatDefault(value: unknown, type: FieldType, dialect: SqlDialect): string | null {
  if (value === null || value === undefined) return null;
  switch (type) {
    case 'reference':
    case 'string':
      return quoteSqlString(String(value));
    case 'number': {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n)) return null;
      return String(n);
    }
    case 'boolean': {
      const b = Boolean(value);
      if (dialect === 'postgresql') return b ? 'TRUE' : 'FALSE';
      if (dialect === 'sqlite') return b ? '1' : '0';
      return b ? 'True' : 'False';
    }
    case 'date':
      return quoteSqlString(String(value));
  }
}

function buildColumnDdl(field: FieldDefinition, dialect: SqlDialect): string {
  const parts = [quoteIdentifier(field.name, dialect), TYPE_MAP[dialect][field.type]];
  if (field.required) parts.push('NOT NULL');
  const def = formatDefault(field.defaultValue, field.type, dialect);
  if (def !== null) parts.push(`DEFAULT ${def}`);
  return parts.join(' ');
}

export function generateCreateTable(model: ModelDefinition, dialect: SqlDialect): string {
  if (model.fields.length === 0) {
    throw new Error('フィールドが0件のためSQLを生成できません');
  }
  const tableIdent = quoteIdentifier(model.name, dialect);
  const columns = model.fields.map((f) => `  ${buildColumnDdl(f, dialect)}`);
  return `CREATE TABLE ${tableIdent} (\n${columns.join(',\n')}\n);\n`;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function buildSqlFilename(
  modelName: string,
  dialect: SqlDialect,
  now: Date = new Date(),
): string {
  const stamp =
    `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}` +
    `-${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
  return `${modelName}-${stamp}-${dialect}.sql`;
}
