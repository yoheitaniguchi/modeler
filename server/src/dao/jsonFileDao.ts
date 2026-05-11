import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ModelDefinition, Record as ModelRecord, ReferentialAction } from '@modeler/shared';
import { validateRecord, formatRecord, DEFAULT_ON_DELETE } from '@modeler/shared';
import type { DaoRegistry } from './daoRegistry.js';

/**
 * DAO (Data Access Object) — データの読み書きをカプセル化する層。
 *
 * なぜ DAO を分けるか:
 *   - 永続化の実装 (今は JSON ファイル) を後から差し替えやすくするため。
 *     ルーティング側は「リスト/取得/作成/更新/削除」というメソッドだけを
 *     知っていれば良いので、たとえば DB に置き換えても呼び出し側は無修正。
 *   - 入力の最終バリデーションを必ずここで通すと、HTTP 層で漏れがあっても
 *     不正データが永続化されない (= 守りの最後の砦)。
 *
 * トレードオフ:
 *   - JSON ファイルなので「同時に複数リクエストが来ると読み書きが競合する」
 *     可能性がある。本ツールは開発用なので、簡易ミューテックスで直列化する
 *     程度に留める。本番想定なら SQLite などにすべき。
 */

export class JsonFileDao {
  private readonly filePath: string;
  /** 直列化用のチェーン。new Promise を待ち合わせていくシンプルなロック。 */
  private writeChain: Promise<unknown> = Promise.resolve();
  /** クロスモデル FK チェック用に後注入されるレジストリ。未注入なら整合性チェックは no-op。 */
  private registry?: DaoRegistry;

  constructor(
    private readonly model: ModelDefinition,
    dataDir: string,
  ) {
    this.filePath = path.join(dataDir, `${model.name}.json`);
  }

  /** デプロイ完了後に DeployRegistry が呼び出す。整合性チェックを有効化する。 */
  setRegistry(registry: DaoRegistry): void {
    this.registry = registry;
  }

  /** 自モデルの ModelDefinition を返す。整合性チェック側でフィールドを走査するため公開する。 */
  getModel(): ModelDefinition {
    return this.model;
  }

  /** ストレージ初期化。ファイルがなければ空配列で作る。 */
  async init(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      await fs.access(this.filePath);
    } catch {
      await fs.writeFile(this.filePath, '[]', 'utf-8');
    }
  }

  private async readAll(): Promise<ModelRecord[]> {
    const raw = await fs.readFile(this.filePath, 'utf-8');
    return JSON.parse(raw) as ModelRecord[];
  }

  async list(): Promise<ModelRecord[]> {
    const records = await this.readAll();
    if (this.model.softDelete) {
      return records.filter((r) => r._deleted !== true);
    }
    return records;
  }

  async get(id: string): Promise<ModelRecord | null> {
    const all = await this.list();
    return all.find((r) => String(r.id) === String(id)) ?? null;
  }

  async create(input: Record<string, unknown>): Promise<ModelRecord> {
    const withIds = await this.generateIdFields(input);
    const formatted = formatRecord(this.model, withIds);
    const validation = validateRecord(this.model, formatted);
    if (!validation.ok) {
      throw new DaoValidationError(validation.errors);
    }
    await this.checkOutgoingFkExist(formatted);
    return this.serialize(async () => {
      const all = await this.readAll();
      this.checkUniqueConstraints(formatted, all);
      const record: ModelRecord = { id: randomUUID(), ...formatted };
      all.push(record);
      await this.persist(all);
      return record;
    });
  }

  async update(id: string, input: Record<string, unknown>): Promise<ModelRecord | null> {
    const formatted = formatRecord(this.model, input);
    const validation = validateRecord(this.model, formatted);
    if (!validation.ok) {
      throw new DaoValidationError(validation.errors);
    }
    await this.checkOutgoingFkExist(formatted);
    return this.serialize(async () => {
      const all = await this.readAll();
      const idx = all.findIndex((r) => String(r.id) === String(id));
      if (idx === -1) return null;
      if (this.model.softDelete && all[idx]._deleted) return null; // Cannot update soft-deleted record

      this.checkUniqueConstraints(formatted, all, id);
      // id, _deleted は不変または上書き禁止 (オリジナルの id の型を維持するため all[idx].id を使用)
      all[idx] = { ...formatted, id: all[idx].id, _deleted: all[idx]._deleted };
      await this.persist(all);
      return all[idx];
    });
  }

  async remove(id: string, visited: Set<string> = new Set()): Promise<boolean> {
    const visitKey = `${this.model.name}:${id}`;
    if (visited.has(visitKey)) return true; // 循環: 既に処理対象 → 二重削除を防止
    visited.add(visitKey);

    // 削除前に被参照を解決する (restrict 系で 1 件でもあれば throw / cascade で連鎖 / setNull で null 化)。
    // 自モデルの serialize ロック内に入る前に解決する。serialize の中で他 DAO の
    // serialize を待つとロック競合が発生する可能性があるため、外で解決してから
    // 自モデルの delete に進む。
    await this.resolveIncomingReferences(id, visited);

    return this.serialize(async () => {
      const all = await this.readAll();
      const idx = all.findIndex((r) => String(r.id) === String(id));
      if (idx === -1) return false;

      if (this.model.softDelete) {
        if (all[idx]._deleted) return false; // Already deleted
        all[idx] = { ...all[idx], _deleted: true };
        await this.persist(all);
        return true;
      } else {
        const next = all.filter((r) => String(r.id) !== String(id));
        if (next.length === all.length) return false;
        await this.persist(next);
        return true;
      }
    });
  }

  /**
   * create/update 時に自モデルの reference 値が targetModel に実在するかチェック。
   * registry 未注入 (= 単独使用) なら no-op。
   */
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
        errors.push(`${field.name}: target model "${field.targetModel}" is not deployed`);
        continue;
      }
      const exists = await targetDao.get(String(val));
      if (!exists) {
        errors.push(
          `${field.name}: referenced ${field.targetModel} id "${String(val)}" does not exist`,
        );
      }
    }
    if (errors.length > 0) throw new DaoValidationError(errors);
  }

  /**
   * remove 時の被参照解決。registry を辿って自モデルへの reference を持つ
   * 他モデルを集め、onDelete に応じて処理する。
   * - restrict / noAction: 1 件でもあれば DaoValidationError を throw
   * - cascade: 各被参照レコードを再帰的に remove
   * - setNull: 各被参照レコードのフィールドを null に更新
   */
  private async resolveIncomingReferences(id: string, visited: Set<string>): Promise<void> {
    if (!this.registry) return;

    type Incoming = {
      otherModel: ModelDefinition;
      otherDao: JsonFileDao;
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

    // まず restrict / noAction を先にチェック (cascade/setNull の副作用を起こす前に阻止)
    const blockErrors: string[] = [];
    for (const inc of incomings) {
      if (inc.field.onDelete !== 'restrict' && inc.field.onDelete !== 'noAction') continue;
      const all = await inc.otherDao.list();
      const blockers = all.filter((r) => String(r[inc.field.name]) === String(id));
      if (blockers.length > 0) {
        blockErrors.push(
          `cannot delete: ${inc.otherModel.name}.${inc.field.name} still references this id (${blockers.length} record${blockers.length === 1 ? '' : 's'})`,
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
          // _deleted / id は update 側で保持されるので除外したペイロードを渡す
          const { id: _id, _deleted, ...rest } = t;
          void _id;
          void _deleted;
          await inc.otherDao.update(t.id, { ...rest, [inc.field.name]: null });
        }
      }
    }
  }

  private checkUniqueConstraints(input: Record<string, unknown>, all: ModelRecord[], excludeId?: string): void {
    const errors: string[] = [];
    
    // Check standard unique constraints
    for (const field of this.model.fields) {
      if (field.validation?.unique) {
        const val = input[field.name];
        if (val === undefined || val === null || val === '') continue;

        // If softDelete is enabled, should we allow duplicates with deleted records?
        // Usually soft deleted records shouldn't block new inserts, but depends on requirements.
        // For simplicity, let's only check non-deleted records for unique constraint.
        const dup = all.some(r => String(r.id) !== String(excludeId) && r._deleted !== true && r[field.name] === val);
        if (dup) {
          errors.push(`${field.name}: must be unique`);
        }
      }
    }

    // Check primary key constraints (single or composite)
    const pkFields = this.model.fields.filter(f => f.primaryKey);
    if (pkFields.length > 0) {
      const missingPk = pkFields.filter(f => {
        const val = input[f.name];
        return val === undefined || val === null || val === '';
      });
      if (missingPk.length > 0) {
        missingPk.forEach(f => errors.push(`${f.name}: is required (Primary Key)`));
      } else {
        const dup = all.some(r => {
          if (excludeId !== undefined && String(r.id) === String(excludeId)) {
            return false;
          }
          if (this.model.softDelete && r._deleted === true) {
            return false;
          }
          return pkFields.every(field => {
            const val1 = input[field.name];
            const val2 = r[field.name];
            return String(val1) === String(val2);
          });
        });

        if (dup) {
          if (pkFields.length === 1) {
            errors.push(`${pkFields[0].name}: must be unique (Primary Key)`);
          } else {
            const names = pkFields.map(f => f.name).join(', ');
            errors.push(`composite primary key (${names}): must be unique`);
          }
        }
      }
    }

    if (errors.length > 0) {
      throw new DaoValidationError(errors);
    }
  }

  private async generateIdFields(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    const result = { ...input };
    for (const field of this.model.fields) {
      if (field.type === 'id') {
        const val = result[field.name];
        if (val === undefined || val === null || val === '') {
          let generatedId: string | undefined = undefined;
          if (field.numberingUrl) {
            try {
              const url = field.numberingUrl.startsWith('http')
                ? field.numberingUrl
                : `http://localhost:${process.env.PORT || 4000}${field.numberingUrl}`;
              const res = await fetch(url);
              if (res.ok) {
                const contentType = res.headers.get('content-type') ?? '';
                if (contentType.includes('application/json')) {
                   const json = await res.json() as Record<string, unknown>;
                   generatedId = String(json.id ?? json.number ?? json.value ?? json.code ?? Object.values(json)[0] ?? '');
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
      }
    }
    return result;
  }

  private async persist(records: ModelRecord[]): Promise<void> {
    // JSON の整形は人間が覗きに行きやすいように 2 スペースで。
    await fs.writeFile(this.filePath, JSON.stringify(records, null, 2), 'utf-8');
  }

  /**
   * 書き込み系を直列化するためのヘルパー。
   * Promise.then のチェーンに繋ぐことで「前の書き込みが終わってから次が走る」
   * を保証している。Node.js のシングルスレッドモデルでは I/O さえ直列化すれば
   * 競合が発生しないので、これで充分シンプルかつ正しい。
   */
  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const next = this.writeChain.then(task, task);
    // チェーンが拒否で詰まらないように、結果は捨てて成功扱いに変換する
    this.writeChain = next.catch(() => undefined);
    return next;
  }
}

export class DaoValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(`Validation failed: ${errors.join(', ')}`);
    this.name = 'DaoValidationError';
  }
}
