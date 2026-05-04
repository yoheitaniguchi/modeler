import type { ModelDefinition, ModelDefinitionDocument, Record as ModelRecord } from '@modeler/shared';
import type { ApiClient } from '../services/api.js';

/**
 * テスト用の偽 API。
 * メモリ上で deploy/CRUD をシミュレートし、ネットワークなしで ViewModel を検証できる。
 */
export function createFakeApi(): ApiClient & { _store: Map<string, ModelRecord[]>; _models: ModelDefinition[] } {
  const store = new Map<string, ModelRecord[]>();
  let models: ModelDefinition[] = [];
  let counter = 0;
  const nextId = () => `id-${++counter}`;

  return {
    _store: store,
    get _models() { return models; },
    set _models(v: ModelDefinition[]) { models = v; },
    async deploy(doc: ModelDefinitionDocument) {
      models = doc.models;
      for (const m of models) if (!store.has(m.name)) store.set(m.name, []);
      return { deployed: models };
    },
    async listModels() { return models; },
    async list(name) { return store.get(name) ?? []; },
    async create(name, body) {
      const record: ModelRecord = { id: nextId(), ...body };
      const arr = store.get(name) ?? [];
      arr.push(record);
      store.set(name, arr);
      return record;
    },
    async update(name, id, body) {
      const arr = store.get(name) ?? [];
      const idx = arr.findIndex((r) => r.id === id);
      if (idx === -1) throw new Error('not found');
      arr[idx] = { ...body, id };
      return arr[idx];
    },
    async remove(name, id) {
      const arr = store.get(name) ?? [];
      store.set(name, arr.filter((r) => r.id !== id));
    },
  };
}
