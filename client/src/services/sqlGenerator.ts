import type {
  FieldDefinition,
  FieldType,
  ModelDefinition,
  ReferentialAction,
} from '@modeler/shared';
import { DEFAULT_ON_DELETE, DEFAULT_ON_UPDATE } from '@modeler/shared';

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
    id: 'TEXT',
  },
  sqlite: {
    string: 'TEXT',
    number: 'NUMERIC',
    boolean: 'INTEGER',
    date: 'TEXT',
    reference: 'TEXT',
    id: 'TEXT',
  },
  msaccess: {
    string: 'TEXT',
    number: 'DOUBLE',
    boolean: 'BIT',
    date: 'DATETIME',
    reference: 'TEXT',
    id: 'TEXT',
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
    case 'id':
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

const REFERENTIAL_ACTION_SQL: Record<ReferentialAction, string> = {
  restrict: 'RESTRICT',
  cascade: 'CASCADE',
  setNull: 'SET NULL',
  noAction: 'NO ACTION',
};

function buildForeignKeyDdl(
  model: ModelDefinition,
  field: FieldDefinition,
  dialect: SqlDialect,
): { ddl: string; comment?: string } | null {
  if (field.type !== 'reference') return null;
  if (!field.targetModel) return null;
  const constraintName = `fk_${model.name}_${field.name}`;
  const constraintIdent = quoteIdentifier(constraintName, dialect);
  const colIdent = quoteIdentifier(field.name, dialect);
  const refTableIdent = quoteIdentifier(field.targetModel, dialect);
  const refColIdent = quoteIdentifier('id', dialect);
  const base = `CONSTRAINT ${constraintIdent} FOREIGN KEY (${colIdent}) REFERENCES ${refTableIdent}(${refColIdent})`;
  if (dialect === 'msaccess') {
    // MS Access (Jet SQL) は CREATE TABLE 内で ON DELETE / ON UPDATE をサポートしない。
    return {
      ddl: base,
      comment: '-- ON DELETE/UPDATE not supported in MS Access DDL',
    };
  }
  const onDelete = REFERENTIAL_ACTION_SQL[field.onDelete ?? DEFAULT_ON_DELETE];
  const onUpdate = REFERENTIAL_ACTION_SQL[field.onUpdate ?? DEFAULT_ON_UPDATE];
  return { ddl: `${base} ON DELETE ${onDelete} ON UPDATE ${onUpdate}` };
}

export function generateCreateTable(model: ModelDefinition, dialect: SqlDialect): string {
  if (model.fields.length === 0) {
    throw new Error('フィールドが0件のためSQLを生成できません');
  }
  const tableIdent = quoteIdentifier(model.name, dialect);
  const columnLines = model.fields.map((f) => `  ${buildColumnDdl(f, dialect)}`);
  const fkLines: string[] = [];
  for (const f of model.fields) {
    const fk = buildForeignKeyDdl(model, f, dialect);
    if (!fk) continue;
    if (fk.comment) fkLines.push(`  ${fk.comment}`);
    fkLines.push(`  ${fk.ddl}`);
  }
  const bodyLines = [...columnLines, ...fkLines];
  // コメント行はカンマを付けない。各行末カンマ判定: 最終の DDL 行のみカンマなし、その他は付与。
  const joined = bodyLines
    .map((line, idx) => {
      const isComment = line.trimStart().startsWith('--');
      if (isComment) return line;
      // 次の非コメント行が存在するかチェック
      const hasMoreDdl = bodyLines.slice(idx + 1).some((l) => !l.trimStart().startsWith('--'));
      return hasMoreDdl ? `${line},` : line;
    })
    .join('\n');
  return `CREATE TABLE ${tableIdent} (\n${joined}\n);\n`;
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
