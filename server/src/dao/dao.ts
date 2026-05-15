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
