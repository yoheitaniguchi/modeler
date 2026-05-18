import type { ModelDefinition, Record as ModelRecord } from '@modeler/shared';
import type { DaoRegistry } from './daoRegistry.js';

/**
 * DAO の共通インターフェース。
 *
 * レジストリや CRUD ルータは具象 (JsonFileDao / PostgresDao) ではなく
 * このインターフェースに依存することで、ストレージ差し替えがしやすくなる。
 */
export interface Dao {
  init(): Promise<void>;
  setRegistry(registry: DaoRegistry): void;
  getModel(): ModelDefinition;
  list(): Promise<ModelRecord[]>;
  get(id: string): Promise<ModelRecord | null>;
  /**
   * 指定フィールドが値 `id` に一致するレコードを返す。FK 整合性解決
   * (restrict/cascade/setNull) で「このモデルを参照している行」を SQL の
   * WHERE で直接絞り込むために使う。list() で全件取得して JS 側で filter
   * するより、転送量・メモリ・走査コストを大幅に削減できる。
   */
  listReferencing(fieldName: string, id: string): Promise<ModelRecord[]>;
  create(input: Record<string, unknown>): Promise<ModelRecord>;
  update(id: string, input: Record<string, unknown>): Promise<ModelRecord | null>;
  remove(id: string, visited?: Set<string>): Promise<boolean>;
}

/** DAO 共通のバリデーションエラー。HTTP 層で 400 にマップされる。 */
export class DaoValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(`Validation failed: ${errors.join(', ')}`);
    this.name = 'DaoValidationError';
  }
}
