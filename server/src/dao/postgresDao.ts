import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type {
  FieldDefinition,
  ModelDefinition,
  Record as ModelRecord,
  ReferentialAction,
} from '@modeler/shared';
import { validateRecord, formatRecord, DEFAULT_ON_DELETE, getMessage, MSG } from '@modeler/shared';
import { Dao, DaoValidationError } from './dao.js';
import type { DaoRegistry } from './daoRegistry.js';
import { quoteIdent } from '../db/schema.js';

export { DaoValidationError } from './dao.js';

function getTodayString(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * PostgreSQL に永続化する DAO。
 *
 * 設計方針:
 *   - 公開 API と挙動 (エラーメッセージ書式、soft-delete セマンティクス、
 *     FK の restrict/cascade/setNull 解決、ID 自動採番) は旧 JsonFileDao と同等。
 *     クライアント/UI はメッセージ文字列に依存しているため、ここを変えない。
 *   - 書き込みはトランザクション (BEGIN/COMMIT) で囲み、ユニーク判定の TOCTOU
 *     リスクは「対象行を FOR UPDATE で先に押さえる」ことで軽減する。
 *   - DB レベルでも UNIQUE / NOT NULL / FK を張っており、ロジック側のすり抜けを
 *     最終防衛で阻止する (二重化)。
 *
 * 注意: テーブル/カラムの DDL は本クラスでは扱わない。DeployRegistry 側で
 *   schema.ts を使って create/alter する前提。本クラスの init() は no-op に近い。
 */
export class PostgresDao implements Dao {
  private registry?: DaoRegistry;

  constructor(
    private readonly model: ModelDefinition,
    private readonly pool: Pool,
  ) {}

  setRegistry(registry: DaoRegistry): void {
    this.registry = registry;
  }

  getModel(): ModelDefinition {
    return this.model;
  }

  async init(): Promise<void> {
    // DDL は DeployRegistry が担当するため何もしない。
    // 互換性のために残してある (旧 JsonFileDao.init() に対応)。
  }

  // ---- 読み取り ----

  async list(): Promise<ModelRecord[]> {
    const where = this.model.softDelete ? ` WHERE ${quoteIdent('_deleted')} = false` : '';
    const res = await this.pool.query(`SELECT * FROM ${quoteIdent(this.model.name)}${where}`);
    return res.rows.map((row) => this.rowToRecord(row as Record<string, unknown>));
  }

  async get(id: string): Promise<ModelRecord | null> {
    const where = this.model.softDelete
      ? ` AND ${quoteIdent('_deleted')} = false`
      : '';
    const res = await this.pool.query(
      `SELECT * FROM ${quoteIdent(this.model.name)} WHERE ${quoteIdent('id')} = $1${where}`,
      [id],
    );
    if (res.rowCount === 0) return null;
    return this.rowToRecord(res.rows[0] as Record<string, unknown>);
  }

  // ---- 書き込み ----

  async create(input: Record<string, unknown>): Promise<ModelRecord> {
    const withDefaults = { ...input };
    for (const f of this.model.fields) {
      if (f.type === 'date') {
        const val = withDefaults[f.name];
        if (val === undefined || val === null || val === '') {
          if (f.defaultValue === 'today') {
            withDefaults[f.name] = getTodayString();
          }
        }
      }
    }
    const withIds = await this.generateIdFields(withDefaults);
    const formatted = formatRecord(this.model, withIds);
    const validation = validateRecord(this.model, formatted);
    if (!validation.ok) {
      throw new DaoValidationError(validation.errors);
    }
    await this.checkOutgoingFkExist(formatted);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.checkUniqueConstraintsInTx(client, formatted, undefined);
      const id = randomUUID();
      const record = await this.insertRow(client, { ...formatted, id });
      await client.query('COMMIT');
      return record;
    } catch (e) {
      await safeRollback(client);
      throw e;
    } finally {
      client.release();
    }
  }

  async update(id: string, input: Record<string, unknown>): Promise<ModelRecord | null> {
    const withUpdateDefaults = { ...input };
    for (const f of this.model.fields) {
      if (f.type === 'date' && f.defaultOnUpdate) {
        withUpdateDefaults[f.name] = getTodayString();
      }
    }
    const formatted = formatRecord(this.model, withUpdateDefaults);
    const validation = validateRecord(this.model, formatted);
    if (!validation.ok) {
      throw new DaoValidationError(validation.errors);
    }
    await this.checkOutgoingFkExist(formatted);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // 対象行を FOR UPDATE で押さえつつ存在確認 (softDelete 済みは更新不可)
      const existing = await client.query(
        `SELECT * FROM ${quoteIdent(this.model.name)} WHERE ${quoteIdent('id')} = $1 FOR UPDATE`,
        [id],
      );
      if (existing.rowCount === 0) {
        await client.query('ROLLBACK');
        return null;
      }
      const row = existing.rows[0] as Record<string, unknown>;
      if (this.model.softDelete && row._deleted === true) {
        await client.query('ROLLBACK');
        return null;
      }
      await this.checkUniqueConstraintsInTx(client, formatted, id);
      const updated = await this.updateRow(client, id, formatted);
      await client.query('COMMIT');
      return updated;
    } catch (e) {
      await safeRollback(client);
      throw e;
    } finally {
      client.release();
    }
  }

  async remove(id: string, visited: Set<string> = new Set()): Promise<boolean> {
    const visitKey = `${this.model.name}:${id}`;
    if (visited.has(visitKey)) return true;
    visited.add(visitKey);

    // 被参照は他 DAO 経由で解決 (cascade/setNull) する。ここではトランザクションを
    // 区切る (他テーブル update が独立したロックを取れるように)。
    await this.resolveIncomingReferences(id, visited);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query(
        `SELECT * FROM ${quoteIdent(this.model.name)} WHERE ${quoteIdent('id')} = $1 FOR UPDATE`,
        [id],
      );
      if (existing.rowCount === 0) {
        await client.query('ROLLBACK');
        return false;
      }
      const row = existing.rows[0] as Record<string, unknown>;

      if (this.model.softDelete) {
        if (row._deleted === true) {
          await client.query('ROLLBACK');
          return false;
        }
        const setParts: string[] = [`${quoteIdent('_deleted')} = true`];
        const params: unknown[] = [];
        for (const f of this.model.fields) {
          if (f.type === 'date' && f.defaultOnUpdate) {
            params.push(getTodayString());
            setParts.push(`${quoteIdent(f.name)} = $${params.length}`);
          }
        }
        params.push(id);
        await client.query(
          `UPDATE ${quoteIdent(this.model.name)} SET ${setParts.join(', ')} WHERE ${quoteIdent('id')} = $${params.length}`,
          params,
        );
      } else {
        await client.query(`DELETE FROM ${quoteIdent(this.model.name)} WHERE ${quoteIdent('id')} = $1`, [id]);
      }
      await client.query('COMMIT');
      return true;
    } catch (e) {
      await safeRollback(client);
      throw e;
    } finally {
      client.release();
    }
  }

  // ---- 内部: 行 ↔ Record 変換 ----

  /** JSON 表現に合わせて型を整える (BOOLEAN は boolean のまま、_deleted は softDelete 無効時に落とす)。 */
  private rowToRecord(row: Record<string, unknown>): ModelRecord {
    const out: ModelRecord = { id: String(row.id) };
    for (const f of this.model.fields) {
      const v = row[f.name];
      if (v === undefined || v === null) {
        // 未設定: undefined にする (JSON 化時に欠落する=旧 JsonFileDao 互換)
        out[f.name] = v ?? undefined;
        continue;
      }
      // pg は number → number、boolean → boolean、date → string (型パーサ設定済) で返す
      out[f.name] = v;
    }
    if (this.model.softDelete && row._deleted !== undefined) {
      out._deleted = row._deleted === true;
    }
    return out;
  }

  private async insertRow(
    client: PoolClient,
    record: Record<string, unknown>,
  ): Promise<ModelRecord> {
    const cols: string[] = [quoteIdent('id')];
    const params: unknown[] = [record.id];
    const placeholders: string[] = ['$1'];
    for (const f of this.model.fields) {
      cols.push(quoteIdent(f.name));
      params.push(toDbValue(f, record[f.name]));
      placeholders.push(`$${params.length}`);
    }
    const sql =
      `INSERT INTO ${quoteIdent(this.model.name)} (${cols.join(', ')}) ` +
      `VALUES (${placeholders.join(', ')}) RETURNING *`;
    const res = await client.query(sql, params);
    return this.rowToRecord(res.rows[0] as Record<string, unknown>);
  }

  private async updateRow(
    client: PoolClient,
    id: string,
    record: Record<string, unknown>,
  ): Promise<ModelRecord> {
    const setParts: string[] = [];
    const params: unknown[] = [];
    for (const f of this.model.fields) {
      params.push(toDbValue(f, record[f.name]));
      setParts.push(`${quoteIdent(f.name)} = $${params.length}`);
    }
    params.push(id);
    const sql =
      `UPDATE ${quoteIdent(this.model.name)} SET ${setParts.join(', ')} ` +
      `WHERE ${quoteIdent('id')} = $${params.length} RETURNING *`;
    const res = await client.query(sql, params);
    return this.rowToRecord(res.rows[0] as Record<string, unknown>);
  }

  // ---- 内部: 制約チェック ----

  /** create/update 時、reference 値が targetModel に実在するかチェック。 */
  private async checkOutgoingFkExist(input: Record<string, unknown>): Promise<void> {
    if (!this.registry) return;
    const errors: string[] = [];
    for (const field of this.model.fields) {
      if (field.type !== 'reference') continue;
      if (!field.targetModel) continue;
      const val = input[field.name];
      if (val === undefined || val === null || val === '') continue;
      const targetDao = this.registry.get(field.targetModel);
      if (!targetDao) {
        errors.push(`${field.name}: ${getMessage(MSG.RECORD_FK_TARGET_NOT_DEPLOYED, { targetModel: field.targetModel })}`);
        continue;
      }
      const exists = await targetDao.get(String(val));
      if (!exists) {
        errors.push(
          `${field.name}: ${getMessage(MSG.RECORD_FK_NOT_FOUND, { targetModel: field.targetModel, id: String(val) })}`,
        );
      }
    }
    if (errors.length > 0) throw new DaoValidationError(errors);
  }

  /**
   * ユニーク制約 (validation.unique と primaryKey) を SQL で事前チェック。
   * トランザクション内で実行することで、DB 制約より分かりやすいエラー文字列を返す。
   */
  private async checkUniqueConstraintsInTx(
    client: PoolClient,
    input: Record<string, unknown>,
    excludeId: string | undefined,
  ): Promise<void> {
    const errors: string[] = [];
    const softDeleteFilter = this.model.softDelete
      ? ` AND ${quoteIdent('_deleted')} = false`
      : '';

    // 単一列 UNIQUE
    for (const f of this.model.fields) {
      if (!f.validation?.unique) continue;
      const val = input[f.name];
      if (val === undefined || val === null || val === '') continue;
      const params: unknown[] = [toDbValue(f, val)];
      let sql = `SELECT 1 FROM ${quoteIdent(this.model.name)} WHERE ${quoteIdent(f.name)} = $1`;
      if (excludeId !== undefined) {
        params.push(excludeId);
        sql += ` AND ${quoteIdent('id')} <> $${params.length}`;
      }
      sql += softDeleteFilter + ' LIMIT 1';
      const dup = await client.query(sql, params);
      if (dup.rowCount !== null && dup.rowCount > 0) {
        errors.push(`${f.name}: ${getMessage(MSG.RECORD_MUST_BE_UNIQUE)}`);
      }
    }

    // 複合主キー
    const pkFields = this.model.fields.filter((f) => f.primaryKey);
    if (pkFields.length > 0) {
      const missingPk = pkFields.filter((f) => {
        const v = input[f.name];
        return v === undefined || v === null || v === '';
      });
      if (missingPk.length > 0) {
        for (const f of missingPk) errors.push(`${f.name}: ${getMessage(MSG.RECORD_PK_REQUIRED)}`);
      } else {
        const params: unknown[] = [];
        const conds: string[] = [];
        for (const f of pkFields) {
          params.push(toDbValue(f, input[f.name]));
          conds.push(`${quoteIdent(f.name)} = $${params.length}`);
        }
        let sql = `SELECT 1 FROM ${quoteIdent(this.model.name)} WHERE ${conds.join(' AND ')}`;
        if (excludeId !== undefined) {
          params.push(excludeId);
          sql += ` AND ${quoteIdent('id')} <> $${params.length}`;
        }
        sql += softDeleteFilter + ' LIMIT 1';
        const dup = await client.query(sql, params);
        if (dup.rowCount !== null && dup.rowCount > 0) {
          if (pkFields.length === 1) {
            errors.push(`${pkFields[0].name}: ${getMessage(MSG.RECORD_PK_MUST_BE_UNIQUE)}`);
          } else {
            const names = pkFields.map((f) => f.name).join(', ');
            errors.push(getMessage(MSG.RECORD_COMPOSITE_PK_UNIQUE, { names }));
          }
        }
      }
    }

    if (errors.length > 0) throw new DaoValidationError(errors);
  }

  /**
   * remove 時の被参照解決。restrict ならエラー、cascade なら連鎖削除、
   * setNull なら参照側を null に更新する。JsonFileDao と同じ責務分担。
   */
  private async resolveIncomingReferences(id: string, visited: Set<string>): Promise<void> {
    if (!this.registry) return;

    type Incoming = {
      otherModel: ModelDefinition;
      otherDao: Dao;
      field: { name: string; onDelete: ReferentialAction };
    };
    const incomings: Incoming[] = [];
    for (const other of this.registry.models()) {
      const otherDao = this.registry.get(other.name);
      if (!otherDao) continue;
      for (const f of other.fields) {
        if (f.type !== 'reference') continue;
        if (f.targetModel !== this.model.name) continue;
        incomings.push({
          otherModel: other,
          otherDao,
          field: { name: f.name, onDelete: f.onDelete ?? DEFAULT_ON_DELETE },
        });
      }
    }

    // restrict / noAction を先にチェック
    const blockErrors: string[] = [];
    for (const inc of incomings) {
      if (inc.field.onDelete !== 'restrict' && inc.field.onDelete !== 'noAction') continue;
      const all = await inc.otherDao.list();
      const blockers = all.filter((r) => String(r[inc.field.name]) === String(id));
      if (blockers.length > 0) {
        blockErrors.push(
          getMessage(MSG.RECORD_REFERENCED, {
            otherModel: inc.otherModel.name,
            field: inc.field.name,
            count: blockers.length,
            plural: blockers.length === 1 ? '' : 's',
          }),
        );
      }
    }
    if (blockErrors.length > 0) throw new DaoValidationError(blockErrors);

    // cascade / setNull を適用
    for (const inc of incomings) {
      if (inc.field.onDelete === 'cascade') {
        const all = await inc.otherDao.list();
        const targets = all.filter((r) => String(r[inc.field.name]) === String(id));
        for (const t of targets) {
          await inc.otherDao.remove(t.id, visited);
        }
      } else if (inc.field.onDelete === 'setNull') {
        const all = await inc.otherDao.list();
        const targets = all.filter((r) => String(r[inc.field.name]) === String(id));
        for (const t of targets) {
          const { id: _id, _deleted, ...rest } = t;
          void _id;
          void _deleted;
          await inc.otherDao.update(t.id, { ...rest, [inc.field.name]: null });
        }
      }
    }
  }

  /** type='id' のフィールドを生成または numberingUrl から取得する。 */
  private async generateIdFields(
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const result = { ...input };
    for (const field of this.model.fields) {
      if (field.type !== 'id') continue;
      const val = result[field.name];
      if (val !== undefined && val !== null && val !== '') continue;

      let generatedId: string | undefined;
      if (field.numberingUrl) {
        try {
          const url = field.numberingUrl.startsWith('http')
            ? field.numberingUrl
            : `http://localhost:${process.env.PORT || 4000}${field.numberingUrl}`;
          const res = await fetch(url);
          if (res.ok) {
            const contentType = res.headers.get('content-type') ?? '';
            if (contentType.includes('application/json')) {
              const json = (await res.json()) as Record<string, unknown>;
              generatedId = String(
                json.id ?? json.number ?? json.value ?? json.code ?? Object.values(json)[0] ?? '',
              );
            } else {
              generatedId = (await res.text()).trim();
            }
          }
        } catch (err) {
          console.error(`Failed to fetch custom numbering from ${field.numberingUrl}:`, err);
        }
      }
      if (!generatedId) {
        generatedId = randomUUID();
      }
      result[field.name] = generatedId;
    }
    return result;
  }
}

/** field 型に応じた DB 値変換。空文字は NULL に、boolean/number はそのまま。 */
function toDbValue(field: FieldDefinition, value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && value === '') return null;
  // 数値型を文字列で受け取ったとき (フォーマッタを通過した直後など) は数値に戻す
  if (field.type === 'number' && typeof value === 'string') {
    const n = Number(value);
    return Number.isNaN(n) ? null : n;
  }
  return value;
}

async function safeRollback(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // ロールバック自体に失敗してもクラッシュさせない
  }
}
