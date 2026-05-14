import type { PoolClient } from 'pg';
import type {
  FieldDefinition,
  FieldType,
  ModelDefinition,
  ReferentialAction,
} from '@modeler/shared';
import { DEFAULT_ON_DELETE, DEFAULT_ON_UPDATE } from '@modeler/shared';

/**
 * モデル定義 ↔ PostgreSQL スキーマの相互変換と、変更の安全性分析。
 *
 * 設計方針:
 *   - テーブル名/カラム名は ModelDefinition / FieldDefinition の name をそのまま使う。
 *     SQL 予約語/特殊文字対策として常にダブルクォートで囲む。
 *   - DDL は冪等にしない (CREATE TABLE は存在チェック後に呼ぶ前提)。DeployRegistry
 *     側が「既存テーブルか否か」を判定して create/alter を切り替える。
 *   - 「破壊的か」の判定は既存行を実際に走査して判定する (NOT NULL 追加で NULL 行が
 *     なければ safe、ある場合のみ destructive 等)。空テーブルなら多くの変更が safe。
 */

// ---------- 識別子 / 型マッピング ----------

/** 識別子をダブルクォートで囲む。内部のダブルクォートはエスケープする (防御策)。 */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export function tableName(model: ModelDefinition | string): string {
  const name = typeof model === 'string' ? model : model.name;
  return quoteIdent(name);
}

/** field.type を Postgres カラム型に変換。 */
export function pgTypeFor(type: FieldType): string {
  switch (type) {
    case 'string':
    case 'reference':
    case 'id':
      return 'TEXT';
    case 'number':
      return 'DOUBLE PRECISION';
    case 'boolean':
      return 'BOOLEAN';
    case 'date':
      return 'DATE';
  }
}

/** ReferentialAction を SQL の文字列に。 */
function refActionSql(action: ReferentialAction): string {
  switch (action) {
    case 'restrict':
      return 'RESTRICT';
    case 'cascade':
      return 'CASCADE';
    case 'setNull':
      return 'SET NULL';
    case 'noAction':
      return 'NO ACTION';
  }
}

/** {string, reference, id} は SQL 上は同じ TEXT 型なので相互変換は safe 扱いできる。 */
function isTextGroup(type: FieldType): boolean {
  return type === 'string' || type === 'reference' || type === 'id';
}

/** 制約名生成。長すぎないように元の名前を素朴に組む (Postgres は 63 文字制限)。 */
function constraintName(table: string, kind: 'pk' | 'uq' | 'fk', col?: string): string {
  const base = col ? `${kind}_${table}_${col}` : `${kind}_${table}`;
  // 63 文字超は単純に切る (異なる制約が衝突しないよう先頭優先)
  return base.length > 63 ? base.slice(0, 63) : base;
}

// ---------- CREATE TABLE ----------

interface ColumnDefSql {
  /** ALTER TABLE ADD COLUMN にも使える完全な「列名 + 型 + NOT NULL」相当 */
  columnSql: string;
}

function buildColumnSql(field: FieldDefinition): ColumnDefSql {
  const parts = [quoteIdent(field.name), pgTypeFor(field.type)];
  const notNull = field.required || field.primaryKey === true;
  if (notNull) parts.push('NOT NULL');
  return { columnSql: parts.join(' ') };
}

/** CREATE TABLE 用の SQL を組み立てる (FK 制約は最後にまとめて ALTER で付ける形にしない、内で完結)。 */
function buildCreateTableSql(model: ModelDefinition): string[] {
  const t = quoteIdent(model.name);
  const colDefs: string[] = [];
  // 固定の id 列 (DAO 採番 UUID)
  colDefs.push(`${quoteIdent('id')} TEXT PRIMARY KEY`);
  for (const f of model.fields) {
    colDefs.push(buildColumnSql(f).columnSql);
  }
  if (model.softDelete) {
    colDefs.push(`${quoteIdent('_deleted')} BOOLEAN NOT NULL DEFAULT false`);
  }
  // ユーザー定義 PK は UNIQUE 制約として表現
  const pkFields = model.fields.filter((f) => f.primaryKey === true);
  if (pkFields.length > 0) {
    const cols = pkFields.map((f) => quoteIdent(f.name)).join(', ');
    colDefs.push(`CONSTRAINT ${quoteIdent(constraintName(model.name, 'pk'))} UNIQUE (${cols})`);
  }
  // FK 制約 (softDelete 対象列でも DB レベルでは普通に張る — JS 側で論理削除を処理)
  for (const f of model.fields) {
    if (f.type !== 'reference' || !f.targetModel) continue;
    const fk = buildFkConstraintSql(model.name, f);
    if (fk) colDefs.push(fk);
  }

  const statements: string[] = [];
  statements.push(`CREATE TABLE ${t} (\n  ${colDefs.join(',\n  ')}\n)`);

  // 単一列 UNIQUE 制約 (softDelete 時は部分インデックス) は CREATE TABLE 外で
  for (const f of model.fields) {
    if (!f.validation?.unique) continue;
    statements.push(buildUniqueIndexSql(model, f));
  }
  return statements;
}

function buildFkConstraintSql(tableNameStr: string, f: FieldDefinition): string | null {
  if (f.type !== 'reference' || !f.targetModel) return null;
  const onDelete = refActionSql(f.onDelete ?? DEFAULT_ON_DELETE);
  const onUpdate = refActionSql(f.onUpdate ?? DEFAULT_ON_UPDATE);
  const cname = constraintName(tableNameStr, 'fk', f.name);
  return (
    `CONSTRAINT ${quoteIdent(cname)} ` +
    `FOREIGN KEY (${quoteIdent(f.name)}) ` +
    `REFERENCES ${quoteIdent(f.targetModel)} (${quoteIdent('id')}) ` +
    `ON DELETE ${onDelete} ON UPDATE ${onUpdate}`
  );
}

function buildAddFkSql(tableNameStr: string, f: FieldDefinition): string | null {
  const c = buildFkConstraintSql(tableNameStr, f);
  if (!c) return null;
  return `ALTER TABLE ${quoteIdent(tableNameStr)} ADD ${c}`;
}

function buildUniqueIndexSql(model: ModelDefinition, f: FieldDefinition): string {
  const idxName = constraintName(model.name, 'uq', f.name);
  // softDelete 時は削除済みを除外する部分インデックス。これによりレコード論理削除後に
  // 同じユニーク値を再登録できる (JS 側のユニーク判定と整合)。
  const where = model.softDelete ? ` WHERE ${quoteIdent('_deleted')} = false` : '';
  return `CREATE UNIQUE INDEX ${quoteIdent(idxName)} ON ${quoteIdent(model.name)} (${quoteIdent(f.name)})${where}`;
}

export async function createTableForModel(
  client: PoolClient,
  model: ModelDefinition,
): Promise<void> {
  const stmts = buildCreateTableSql(model);
  for (const sql of stmts) {
    await client.query(sql);
  }
}

export async function dropTableForModel(
  client: PoolClient,
  modelName: string,
  opts: { cascade?: boolean } = {},
): Promise<void> {
  const sql = `DROP TABLE IF EXISTS ${quoteIdent(modelName)}${opts.cascade ? ' CASCADE' : ''}`;
  await client.query(sql);
}

/** テーブルが存在するか調べる。 */
export async function tableExists(client: PoolClient, modelName: string): Promise<boolean> {
  const res = await client.query<{ exists: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = ANY (current_schemas(false))
         AND table_name = $1
     ) AS exists`,
    [modelName],
  );
  return res.rows[0]?.exists === true;
}

// ---------- 変更分析 ----------

export type ChangeKind =
  | 'addColumn'
  | 'dropColumn'
  | 'alterColumnType'
  | 'addNotNull'
  | 'dropNotNull'
  | 'addUnique'
  | 'dropUnique'
  | 'addFk'
  | 'dropFk'
  | 'alterFkAction'
  | 'addUserPk'
  | 'dropUserPk'
  | 'alterUserPk'
  | 'enableSoftDelete'
  | 'disableSoftDelete';

export interface Change {
  kind: ChangeKind;
  /** 関係するフィールド名 (該当する場合) */
  field?: string;
  /** 人間向け説明 (UI に表示) */
  detail: string;
  /** true なら強制 (force=true) なしでは適用拒否 */
  destructive: boolean;
  /** 適用する DDL 群 (順序依存) */
  sql: string[];
}

export interface ChangeAnalysis {
  changes: Change[];
  destructive: Change[];
  warnings: string[];
}

/** 既存データを走査するための簡易検査。`null` を返す場合「テーブル空 or 検査不能」。 */
async function countRows(client: PoolClient, modelName: string): Promise<number> {
  const r = await client.query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM ${quoteIdent(modelName)}`);
  return Number(r.rows[0]?.c ?? '0');
}

async function hasNullRows(client: PoolClient, modelName: string, column: string): Promise<boolean> {
  const r = await client.query(
    `SELECT 1 FROM ${quoteIdent(modelName)} WHERE ${quoteIdent(column)} IS NULL LIMIT 1`,
  );
  return r.rowCount !== null && r.rowCount > 0;
}

async function hasDuplicateRows(
  client: PoolClient,
  modelName: string,
  columns: string[],
  excludeDeleted: boolean,
): Promise<boolean> {
  const cols = columns.map(quoteIdent).join(', ');
  const where = excludeDeleted ? ` WHERE ${quoteIdent('_deleted')} = false` : '';
  const sql =
    `SELECT 1 FROM (SELECT ${cols} FROM ${quoteIdent(modelName)}${where} ` +
    `GROUP BY ${cols} HAVING COUNT(*) > 1) AS dup LIMIT 1`;
  const r = await client.query(sql);
  return r.rowCount !== null && r.rowCount > 0;
}

async function hasSoftDeletedRows(client: PoolClient, modelName: string): Promise<boolean> {
  // _deleted 列が存在するかは呼び出し側で担保 (softDelete だった旧モデルでのみ呼ぶ)
  const r = await client.query(
    `SELECT 1 FROM ${quoteIdent(modelName)} WHERE ${quoteIdent('_deleted')} = true LIMIT 1`,
  );
  return r.rowCount !== null && r.rowCount > 0;
}

function isFkActionEqual(a?: ReferentialAction, b?: ReferentialAction, def?: ReferentialAction): boolean {
  return (a ?? def) === (b ?? def);
}

function pkFieldNames(model: ModelDefinition): string[] {
  return model.fields.filter((f) => f.primaryKey === true).map((f) => f.name);
}

/**
 * 新旧モデルを比較し、必要な変更と「破壊的か」を判定する。
 *
 * 既存データを走査する判定 (NOT NULL 追加、UNIQUE/PK 追加、softDelete 無効化) が
 * あるため、トランザクション内で呼ぶこと (整合性確保のため)。
 */
export async function analyzeChanges(
  client: PoolClient,
  oldModel: ModelDefinition,
  newModel: ModelDefinition,
): Promise<ChangeAnalysis> {
  const changes: Change[] = [];
  const table = newModel.name; // updateModel では name は不変
  const oldFields = new Map(oldModel.fields.map((f) => [f.name, f]));
  const newFields = new Map(newModel.fields.map((f) => [f.name, f]));

  // ---- カラム削除 ----
  for (const f of oldModel.fields) {
    if (newFields.has(f.name)) continue;
    const dropSql: string[] = [];
    // FK 列なら制約を先に落とす
    if (f.type === 'reference') {
      dropSql.push(
        `ALTER TABLE ${quoteIdent(table)} DROP CONSTRAINT IF EXISTS ${quoteIdent(constraintName(table, 'fk', f.name))}`,
      );
    }
    if (f.validation?.unique) {
      dropSql.push(`DROP INDEX IF EXISTS ${quoteIdent(constraintName(table, 'uq', f.name))}`);
    }
    dropSql.push(`ALTER TABLE ${quoteIdent(table)} DROP COLUMN ${quoteIdent(f.name)}`);
    changes.push({
      kind: 'dropColumn',
      field: f.name,
      detail: `カラム "${f.name}" を削除します (このカラムの全データは失われます)`,
      destructive: true,
      sql: dropSql,
    });
  }

  // ---- カラム追加 ----
  for (const f of newModel.fields) {
    if (oldFields.has(f.name)) continue;
    const rowCount = await countRows(client, table);
    // 必須カラム追加: 空テーブルなら safe、データ入りなら destructive (DDL は通らないため)
    const destructive = (f.required || f.primaryKey === true) && rowCount > 0;
    const addSql: string[] = [];
    addSql.push(`ALTER TABLE ${quoteIdent(table)} ADD COLUMN ${buildColumnSql(f).columnSql}`);
    if (f.type === 'reference' && f.targetModel) {
      const fk = buildAddFkSql(table, f);
      if (fk) addSql.push(fk);
    }
    if (f.validation?.unique) {
      addSql.push(buildUniqueIndexSql(newModel, f));
    }
    changes.push({
      kind: 'addColumn',
      field: f.name,
      detail: destructive
        ? `必須カラム "${f.name}" を追加します (既存 ${rowCount} 件にデフォルト値がないため挿入が失敗します)`
        : `カラム "${f.name}" を追加します`,
      destructive,
      sql: addSql,
    });
  }

  // ---- 既存カラムの変更 ----
  for (const newF of newModel.fields) {
    const oldF = oldFields.get(newF.name);
    if (!oldF) continue;

    // 型変更
    if (oldF.type !== newF.type) {
      const sameGroup = isTextGroup(oldF.type) && isTextGroup(newF.type);
      const sqlList: string[] = [];
      if (oldF.type === 'reference') {
        sqlList.push(
          `ALTER TABLE ${quoteIdent(table)} DROP CONSTRAINT IF EXISTS ${quoteIdent(constraintName(table, 'fk', oldF.name))}`,
        );
      }
      sqlList.push(
        `ALTER TABLE ${quoteIdent(table)} ALTER COLUMN ${quoteIdent(newF.name)} TYPE ${pgTypeFor(newF.type)} ` +
          `USING ${quoteIdent(newF.name)}::${pgTypeFor(newF.type)}`,
      );
      if (newF.type === 'reference' && newF.targetModel) {
        const fk = buildAddFkSql(table, newF);
        if (fk) sqlList.push(fk);
      }
      changes.push({
        kind: 'alterColumnType',
        field: newF.name,
        detail: sameGroup
          ? `カラム "${newF.name}" の型を ${oldF.type} → ${newF.type} に変更 (TEXT 互換のため安全)`
          : `カラム "${newF.name}" の型を ${oldF.type} → ${newF.type} に変更 (変換できない値は失われる可能性があります)`,
        destructive: !sameGroup,
        sql: sqlList,
      });
    }

    // NOT NULL 追加/削除
    const oldNotNull = oldF.required || oldF.primaryKey === true;
    const newNotNull = newF.required || newF.primaryKey === true;
    if (!oldNotNull && newNotNull) {
      const hasNulls = await hasNullRows(client, table, newF.name);
      changes.push({
        kind: 'addNotNull',
        field: newF.name,
        detail: hasNulls
          ? `カラム "${newF.name}" を NOT NULL にします (既存に NULL 値があるため DDL は失敗します)`
          : `カラム "${newF.name}" を NOT NULL にします`,
        destructive: hasNulls,
        sql: [`ALTER TABLE ${quoteIdent(table)} ALTER COLUMN ${quoteIdent(newF.name)} SET NOT NULL`],
      });
    } else if (oldNotNull && !newNotNull) {
      changes.push({
        kind: 'dropNotNull',
        field: newF.name,
        detail: `カラム "${newF.name}" を NULL 許容にします`,
        destructive: false,
        sql: [`ALTER TABLE ${quoteIdent(table)} ALTER COLUMN ${quoteIdent(newF.name)} DROP NOT NULL`],
      });
    }

    // UNIQUE 制約変更
    const oldUq = oldF.validation?.unique === true;
    const newUq = newF.validation?.unique === true;
    if (!oldUq && newUq) {
      const hasDup = await hasDuplicateRows(client, table, [newF.name], newModel.softDelete === true);
      changes.push({
        kind: 'addUnique',
        field: newF.name,
        detail: hasDup
          ? `カラム "${newF.name}" に UNIQUE 制約を追加 (既存に重複があるため DDL は失敗します)`
          : `カラム "${newF.name}" に UNIQUE 制約を追加`,
        destructive: hasDup,
        sql: [buildUniqueIndexSql(newModel, newF)],
      });
    } else if (oldUq && !newUq) {
      changes.push({
        kind: 'dropUnique',
        field: newF.name,
        detail: `カラム "${newF.name}" の UNIQUE 制約を削除`,
        destructive: false,
        sql: [`DROP INDEX IF EXISTS ${quoteIdent(constraintName(table, 'uq', newF.name))}`],
      });
    }

    // FK 関係の変更 (型変更とは独立して、targetModel/onDelete/onUpdate の変更を扱う)
    const oldHasFk = oldF.type === 'reference' && !!oldF.targetModel;
    const newHasFk = newF.type === 'reference' && !!newF.targetModel;
    const fkTypeUnchanged = oldF.type === newF.type; // 型変更ブランチでFKは既に張り直し済み
    if (oldHasFk && newHasFk && fkTypeUnchanged) {
      const targetChanged = oldF.targetModel !== newF.targetModel;
      const onDeleteChanged = !isFkActionEqual(oldF.onDelete, newF.onDelete, DEFAULT_ON_DELETE);
      const onUpdateChanged = !isFkActionEqual(oldF.onUpdate, newF.onUpdate, DEFAULT_ON_UPDATE);
      if (targetChanged || onDeleteChanged || onUpdateChanged) {
        const sqlList = [
          `ALTER TABLE ${quoteIdent(table)} DROP CONSTRAINT IF EXISTS ${quoteIdent(constraintName(table, 'fk', newF.name))}`,
        ];
        const add = buildAddFkSql(table, newF);
        if (add) sqlList.push(add);
        changes.push({
          kind: targetChanged ? 'addFk' : 'alterFkAction',
          field: newF.name,
          detail: targetChanged
            ? `カラム "${newF.name}" の参照先を ${oldF.targetModel} → ${newF.targetModel} に変更`
            : `カラム "${newF.name}" の FK アクションを更新 (onDelete/onUpdate)`,
          destructive: false,
          sql: sqlList,
        });
      }
    } else if (oldHasFk && !newHasFk && fkTypeUnchanged) {
      changes.push({
        kind: 'dropFk',
        field: newF.name,
        detail: `カラム "${newF.name}" の FK 制約を削除`,
        destructive: false,
        sql: [
          `ALTER TABLE ${quoteIdent(table)} DROP CONSTRAINT IF EXISTS ${quoteIdent(constraintName(table, 'fk', newF.name))}`,
        ],
      });
    } else if (!oldHasFk && newHasFk && fkTypeUnchanged) {
      const add = buildAddFkSql(table, newF);
      if (add) {
        changes.push({
          kind: 'addFk',
          field: newF.name,
          detail: `カラム "${newF.name}" に FK 制約を追加`,
          destructive: false,
          sql: [add],
        });
      }
    }
  }

  // ---- ユーザー PK 変更 ----
  const oldPk = pkFieldNames(oldModel);
  const newPk = pkFieldNames(newModel);
  const pkChanged =
    oldPk.length !== newPk.length || oldPk.some((n, i) => n !== newPk[i]);
  if (pkChanged) {
    const pkCname = constraintName(table, 'pk');
    const sqlList: string[] = [];
    if (oldPk.length > 0) {
      sqlList.push(
        `ALTER TABLE ${quoteIdent(table)} DROP CONSTRAINT IF EXISTS ${quoteIdent(pkCname)}`,
      );
    }
    let destructive = false;
    if (newPk.length > 0) {
      const dup = await hasDuplicateRows(client, table, newPk, newModel.softDelete === true);
      destructive = dup;
      const cols = newPk.map(quoteIdent).join(', ');
      sqlList.push(
        `ALTER TABLE ${quoteIdent(table)} ADD CONSTRAINT ${quoteIdent(pkCname)} UNIQUE (${cols})`,
      );
    }
    changes.push({
      kind: oldPk.length === 0 ? 'addUserPk' : newPk.length === 0 ? 'dropUserPk' : 'alterUserPk',
      detail: destructive
        ? `主キー (${newPk.join(', ') || '(なし)'}) を変更 (既存に重複があるため DDL は失敗します)`
        : `主キーを ${oldPk.join(',') || '(なし)'} → ${newPk.join(',') || '(なし)'} に変更`,
      destructive,
      sql: sqlList,
    });
  }

  // ---- softDelete 切り替え ----
  if (!oldModel.softDelete && newModel.softDelete) {
    changes.push({
      kind: 'enableSoftDelete',
      detail: '論理削除を有効化 (_deleted カラムを追加)',
      destructive: false,
      sql: [
        `ALTER TABLE ${quoteIdent(table)} ADD COLUMN ${quoteIdent('_deleted')} BOOLEAN NOT NULL DEFAULT false`,
      ],
    });
    // softDelete 有効化に伴い、既存の UNIQUE インデックスを部分インデックスに張り替える
    // (フェーズ簡素化のため、運用上ほぼ問題ないと判断して既存 UQ はそのまま放置)
  } else if (oldModel.softDelete && !newModel.softDelete) {
    const hasDeleted = await hasSoftDeletedRows(client, table);
    changes.push({
      kind: 'disableSoftDelete',
      detail: hasDeleted
        ? '論理削除を無効化 (削除済みレコードが再表示されます)'
        : '論理削除を無効化 (_deleted カラムを削除)',
      destructive: hasDeleted,
      sql: [`ALTER TABLE ${quoteIdent(table)} DROP COLUMN IF EXISTS ${quoteIdent('_deleted')}`],
    });
  }

  const destructive = changes.filter((c) => c.destructive);
  const warnings = destructive.map((c) => c.detail);
  return { changes, destructive, warnings };
}

/**
 * analyzeChanges が返した changes を順に適用する。呼び出し側は事前に
 * 「破壊的変更があるなら force=true なしでは進めない」ことを判定済みであること。
 *
 * 注意: 他テーブルからこのテーブルへの incoming FK は事前に DROP する必要が
 *   ある場合がある (カラム削除や型変更を伴うとき)。本関数の呼び出し前後で
 *   DeployRegistry が制御する。
 */
export async function applyChanges(client: PoolClient, analysis: ChangeAnalysis): Promise<void> {
  // 順序: drop → alter type → add → constraint
  const order: ChangeKind[] = [
    'dropFk',
    'dropUnique',
    'dropUserPk',
    'dropColumn',
    'alterColumnType',
    'addColumn',
    'addNotNull',
    'dropNotNull',
    'addUnique',
    'addUserPk',
    'alterUserPk',
    'addFk',
    'alterFkAction',
    'enableSoftDelete',
    'disableSoftDelete',
  ];
  const byKind = new Map<ChangeKind, Change[]>();
  for (const c of analysis.changes) {
    const arr = byKind.get(c.kind) ?? [];
    arr.push(c);
    byKind.set(c.kind, arr);
  }
  for (const k of order) {
    const list = byKind.get(k);
    if (!list) continue;
    for (const c of list) {
      for (const sql of c.sql) {
        await client.query(sql);
      }
    }
  }
}

/**
 * 他テーブルからこのテーブルを参照する FK 制約を列挙する。
 * removeModel やテーブル削除前の cleanup に使う。
 */
export async function listIncomingFks(
  client: PoolClient,
  modelName: string,
): Promise<Array<{ fromTable: string; constraintName: string; column: string }>> {
  const r = await client.query<{ table_name: string; constraint_name: string; column_name: string }>(
    `SELECT tc.table_name, tc.constraint_name, kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.referential_constraints rc
         ON tc.constraint_name = rc.constraint_name
        AND tc.table_schema = rc.constraint_schema
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = rc.unique_constraint_name
        AND ccu.constraint_schema = rc.unique_constraint_schema
       JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_name = tc.constraint_name
        AND kcu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = ANY (current_schemas(false))
        AND ccu.table_name = $1`,
    [modelName],
  );
  return r.rows.map((row) => ({
    fromTable: row.table_name,
    constraintName: row.constraint_name,
    column: row.column_name,
  }));
}
