import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ModelDefinition, Record as ModelRecord } from '@modeler/shared';
import { validateRecord, formatRecord } from '@modeler/shared';

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

  constructor(
    private readonly model: ModelDefinition,
    dataDir: string,
  ) {
    this.filePath = path.join(dataDir, `${model.name}.json`);
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
    return all.find((r) => r.id === id) ?? null;
  }

  async create(input: Record<string, unknown>): Promise<ModelRecord> {
    const formatted = formatRecord(this.model, input);
    const validation = validateRecord(this.model, formatted);
    if (!validation.ok) {
      throw new DaoValidationError(validation.errors);
    }
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
    return this.serialize(async () => {
      const all = await this.readAll();
      const idx = all.findIndex((r) => r.id === id);
      if (idx === -1) return null;
      if (this.model.softDelete && all[idx]._deleted) return null; // Cannot update soft-deleted record

      this.checkUniqueConstraints(formatted, all, id);
      // id, _deleted は不変または上書き禁止
      all[idx] = { ...formatted, id, _deleted: all[idx]._deleted };
      await this.persist(all);
      return all[idx];
    });
  }

  async remove(id: string): Promise<boolean> {
    return this.serialize(async () => {
      const all = await this.readAll();
      const idx = all.findIndex((r) => r.id === id);
      if (idx === -1) return false;

      if (this.model.softDelete) {
        if (all[idx]._deleted) return false; // Already deleted
        all[idx] = { ...all[idx], _deleted: true };
        await this.persist(all);
        return true;
      } else {
        const next = all.filter((r) => r.id !== id);
        if (next.length === all.length) return false;
        await this.persist(next);
        return true;
      }
    });
  }

  private checkUniqueConstraints(input: Record<string, unknown>, all: ModelRecord[], excludeId?: string): void {
    const errors: string[] = [];
    for (const field of this.model.fields) {
      if (field.validation?.unique) {
        const val = input[field.name];
        if (val === undefined || val === null || val === '') continue;

        // If softDelete is enabled, should we allow duplicates with deleted records?
        // Usually soft deleted records shouldn't block new inserts, but depends on requirements.
        // For simplicity, let's only check non-deleted records for unique constraint.
        const dup = all.some(r => r.id !== excludeId && r._deleted !== true && r[field.name] === val);
        if (dup) {
          errors.push(`${field.name}: must be unique`);
        }
      }
    }
    if (errors.length > 0) {
      throw new DaoValidationError(errors);
    }
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
