import express, { type Express, type Router } from 'express';
import type { PoolClient } from 'pg';
import type { ModelDefinition, ModelDefinitionDocument } from '@modeler/shared';
import { validateDocument } from '@modeler/shared';
import { createCrudRouter } from '../routes/crudRouter.js';
import type { Dao } from '../dao/dao.js';
import { DaoRegistryImpl } from '../dao/daoRegistry.js';
import { getPool } from '../db/pool.js';
import {
  analyzeChanges,
  applyChanges,
  createTableForModel,
  dropTableForModel,
  listIncomingFks,
  quoteIdent,
  tableExists,
  type Change,
} from '../db/schema.js';

/**
 * デプロイ済みモデルのレジストリ。
 *
 * 「デプロイボタン押下 → 動的にエンドポイントを生やす」をどう実装するか:
 *   Express 4 系には Router を後から差し替える公式 API がない。
 *   そこで一段間にラッパーミドルウェアを噛ませて、
 *   「現在の active な Router」をそのラッパーが毎回呼ぶ形にしている。
 *   こうすると再デプロイ時に Router を作り直して差し替えるだけで、
 *   外側の app には影響しない。
 *
 * 永続化との関係:
 *   各 PostgresDao はテーブル/カラムの DDL を発行しない。本クラスがデプロイ
 *   タイミングで CREATE TABLE / ALTER TABLE を発行し、その後で DAO を作る。
 *   破壊的変更があり force=true でなければ DestructiveChangeError を投げる。
 */
export class DeployRegistry {
  private current: Router = express.Router();
  private deployed: ModelDefinition[] = [];
  private routerMap = new Map<string, Router>();
  private daoMap = new Map<string, Dao>();

  attach(app: Express, basePath: string): void {
    app.use(basePath, (req, res, next) => this.current(req, res, next));
  }

  list(): ModelDefinition[] {
    return this.deployed.map((m) => ({ ...m, fields: [...m.fields] }));
  }

  getDao(modelName: string): Dao | undefined {
    return this.daoMap.get(modelName);
  }

  private rewireRegistry(): void {
    const registry = new DaoRegistryImpl(new Map(this.daoMap), [...this.deployed]);
    for (const dao of this.daoMap.values()) {
      dao.setRegistry(registry);
    }
  }

  /**
   * 新しいドキュメントを受け取り、DDL を発行してから Router を組み直す。
   *
   * - deployed に無いモデル: CREATE TABLE
   * - deployed にも doc にもあるモデル: analyzeChanges → applyChanges
   * - deployed にあって doc に無いモデル: DROP TABLE (force 必須の場合あり)
   */
  async deploy(
    doc: ModelDefinitionDocument,
    opts: { force?: boolean } = {},
  ): Promise<{ deployed: ModelDefinition[]; warnings: string[] }> {
    const validation = validateDocument(doc);
    if (!validation.ok) {
      throw new DeployError(validation.errors);
    }

    const pool = getPool();
    const client = await pool.connect();
    const force = opts.force === true;
    const warnings: string[] = [];
    const destructiveChanges: Change[] = [];
    try {
      await client.query('BEGIN');

      const newByName = new Map(doc.models.map((m) => [m.name, m]));
      const oldByName = new Map(this.deployed.map((m) => [m.name, m]));

      // 1) 削除候補 (deployed にあって doc にない) を先に処理 — DROP は incoming FK を
      //    持つ場合 force 必須。
      for (const old of this.deployed) {
        if (newByName.has(old.name)) continue;
        const incoming = await listIncomingFks(client, old.name);
        // 削除対象自身が他削除対象しか参照していないなら制約は連動で消えるが、
        // 簡素化のため "doc に残るモデルから参照されている" 場合を阻止条件にする。
        const blocking = incoming.filter((i) => newByName.has(i.fromTable));
        if (blocking.length > 0) {
          const msg = `モデル "${old.name}" は ${blocking.map((b) => `${b.fromTable}.${b.column}`).join(', ')} から参照されています。削除するとそれらの参照も失われます。`;
          destructiveChanges.push({
            kind: 'dropColumn',
            field: undefined,
            detail: msg,
            destructive: true,
            sql: [],
          });
          warnings.push(msg);
        }
      }

      // 2) 既存モデルの変更を分析
      type Pending = { model: ModelDefinition; analysis: Awaited<ReturnType<typeof analyzeChanges>> };
      const pendingAlters: Pending[] = [];
      for (const newModel of doc.models) {
        const oldModel = oldByName.get(newModel.name);
        if (!oldModel) continue;
        const exists = await tableExists(client, newModel.name);
        if (!exists) continue; // 想定外: deployed にあるのに table がない場合は create 側で扱う
        const analysis = await analyzeChanges(client, oldModel, newModel);
        if (analysis.destructive.length > 0) {
          warnings.push(...analysis.warnings);
          destructiveChanges.push(...analysis.destructive);
        }
        pendingAlters.push({ model: newModel, analysis });
      }

      // 3) 破壊的変更があり force=false ならここで中断
      if (destructiveChanges.length > 0 && !force) {
        await client.query('ROLLBACK');
        throw new DestructiveChangeError(warnings, destructiveChanges);
      }

      // 4) DROP TABLE (force 時のみ; 通常はここに来ない=削除対象がないか force=true)
      for (const old of this.deployed) {
        if (newByName.has(old.name)) continue;
        await dropTableForModel(client, old.name, { cascade: force });
      }

      // 5) CREATE TABLE (新規モデル)
      for (const newModel of doc.models) {
        if (oldByName.has(newModel.name)) continue;
        const exists = await tableExists(client, newModel.name);
        if (exists) {
          // 既にテーブルだけ残っているケース (前回のデプロイで registry が空にされたとき等):
          // ALTER で合わせるのが安全だが、新規 doc としては比較対象 oldModel がない。
          // ここでは何もせず既存テーブルをそのまま採用する (運用上は事前に DROP 推奨)。
          continue;
        }
        await createTableForModel(client, newModel);
      }

      // 6) ALTER TABLE (差分適用)
      for (const p of pendingAlters) {
        if (p.analysis.changes.length === 0) continue;
        // 既存の incoming FK 制約を取得 — カラム削除/型変更がある場合に限り一旦剥がす
        const needsDetach = p.analysis.changes.some(
          (c) => c.kind === 'dropColumn' || c.kind === 'alterColumnType',
        );
        let savedFks: Array<{ fromTable: string; sql: string }> = [];
        if (needsDetach) {
          const incoming = await listIncomingFks(client, p.model.name);
          // 元 SQL を information_schema から復元するのは煩雑。本ツールでは
          // 「再デプロイ後に DeployRegistry が再度 ALTER で FK を張り直す」前提で進める。
          for (const fk of incoming) {
            savedFks.push({
              fromTable: fk.fromTable,
              sql: `ALTER TABLE ${quoteIdent(fk.fromTable)} DROP CONSTRAINT IF EXISTS ${quoteIdent(fk.constraintName)}`,
            });
          }
          for (const s of savedFks) await client.query(s.sql);
        }
        await applyChanges(client, p.analysis);
        // 削除した incoming FK の張り直しは、ループ後に新 doc 全体を見て再構築する
      }

      // 7) 全 doc を走査して足りない FK を張り直す (incoming/outgoing 両方とも、
      //    上で剥がしたものや create したばかりのテーブルのものを補う)
      await this.reapplyAllForeignKeys(client, doc.models);

      await client.query('COMMIT');

      // 8) Router/DAO の組み直し
      await this.swapRouters(doc.models);

      return { deployed: this.list(), warnings };
    } catch (e) {
      await safeRollback(client);
      throw e;
    } finally {
      client.release();
    }
  }

  async updateModel(
    name: string,
    updated: ModelDefinition,
    opts: { force?: boolean } = {},
  ): Promise<{ model: ModelDefinition; warnings: string[] } | null> {
    const idx = this.deployed.findIndex((m) => m.name === name);
    if (idx === -1) return null;

    if (updated.name !== name) {
      throw new DeployError(['model.name does not match path']);
    }
    const nextModels = this.deployed.map((m, i) => (i === idx ? updated : m));
    const validation = validateDocument({ version: 1, models: nextModels });
    if (!validation.ok) {
      throw new DeployError(validation.errors);
    }

    // deploy() を doc 全体で呼び出して整合性を担保する (差分は registry が自動判定)
    const result = await this.deploy({ version: 1, models: nextModels }, opts);
    return { model: updated, warnings: result.warnings };
  }

  async removeModel(name: string, opts: { force?: boolean } = {}): Promise<{
    ok: boolean;
    warnings: string[];
  } | null> {
    const idx = this.deployed.findIndex((m) => m.name === name);
    if (idx === -1) return null;

    const pool = getPool();
    const client = await pool.connect();
    const force = opts.force === true;
    try {
      await client.query('BEGIN');
      const incoming = await listIncomingFks(client, name);
      const blocking = incoming.filter((i) => i.fromTable !== name);
      if (blocking.length > 0 && !force) {
        await client.query('ROLLBACK');
        const warnings = [
          `モデル "${name}" は ${blocking.map((b) => `${b.fromTable}.${b.column}`).join(', ')} から参照されています。削除するとそれらの参照も失われます。`,
        ];
        const changes: Change[] = warnings.map((w) => ({
          kind: 'dropColumn',
          detail: w,
          destructive: true,
          sql: [],
        }));
        throw new DestructiveChangeError(warnings, changes);
      }
      await dropTableForModel(client, name, { cascade: force });
      await client.query('COMMIT');
    } catch (e) {
      await safeRollback(client);
      throw e;
    } finally {
      client.release();
    }

    this.deployed = this.deployed.filter((_, i) => i !== idx);
    this.routerMap.delete(name);
    this.daoMap.delete(name);

    const next = express.Router();
    for (const model of this.deployed) {
      const r = this.routerMap.get(model.name);
      if (r) next.use(`/${model.name}`, r);
    }
    this.current = next;
    this.rewireRegistry();
    return { ok: true, warnings: [] };
  }

  /**
   * テスト/起動シャットダウン用。registry を空にする (テーブル DROP はしない)。
   */
  reset(): void {
    this.deployed = [];
    this.routerMap = new Map();
    this.daoMap = new Map();
    this.current = express.Router();
  }

  // ----- 内部ヘルパー -----

  private async swapRouters(models: ModelDefinition[]): Promise<void> {
    const next = express.Router();
    const newRouterMap = new Map<string, Router>();
    const newDaoMap = new Map<string, Dao>();
    await Promise.all(
      models.map(async (model) => {
        const { router, ready, dao } = createCrudRouter(model);
        await ready;
        newRouterMap.set(model.name, router);
        newDaoMap.set(model.name, dao);
        next.use(`/${model.name}`, router);
      }),
    );
    this.current = next;
    this.deployed = models;
    this.routerMap = newRouterMap;
    this.daoMap = newDaoMap;
    this.rewireRegistry();
  }

  /**
   * doc 全モデルの reference field を走査し、現在 DB に存在しない FK 制約を補う。
   * - 既に存在するなら何もしない (FK 名は schema.ts の規約に従う)。
   */
  private async reapplyAllForeignKeys(
    client: PoolClient,
    models: ModelDefinition[],
  ): Promise<void> {
    // 現在の FK 一覧を取得
    const existing = new Set<string>();
    const r = await client.query<{ constraint_name: string; table_name: string }>(
      `SELECT tc.constraint_name, tc.table_name
         FROM information_schema.table_constraints tc
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema = ANY (current_schemas(false))`,
    );
    for (const row of r.rows) existing.add(`${row.table_name}::${row.constraint_name}`);

    for (const model of models) {
      for (const f of model.fields) {
        if (f.type !== 'reference' || !f.targetModel) continue;
        const cname = `fk_${model.name}_${f.name}`.slice(0, 63);
        if (existing.has(`${model.name}::${cname}`)) continue;
        const onDelete = (f.onDelete ?? 'restrict').toUpperCase().replace('SETNULL', 'SET NULL').replace('NOACTION', 'NO ACTION');
        const onUpdate = (f.onUpdate ?? 'noAction').toUpperCase().replace('SETNULL', 'SET NULL').replace('NOACTION', 'NO ACTION');
        await client.query(
          `ALTER TABLE ${quoteIdent(model.name)} ADD CONSTRAINT ${quoteIdent(cname)} ` +
            `FOREIGN KEY (${quoteIdent(f.name)}) REFERENCES ${quoteIdent(f.targetModel)} (${quoteIdent('id')}) ` +
            `ON DELETE ${onDelete} ON UPDATE ${onUpdate}`,
        );
      }
    }
  }
}

async function safeRollback(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // noop
  }
}

export class DeployError extends Error {
  constructor(public readonly errors: string[]) {
    super(`Deploy failed: ${errors.join(', ')}`);
    this.name = 'DeployError';
  }
}

export class DestructiveChangeError extends Error {
  constructor(
    public readonly warnings: string[],
    public readonly changes: Change[],
  ) {
    super(`Destructive change requires confirmation: ${warnings.join('; ')}`);
    this.name = 'DestructiveChangeError';
  }
}
