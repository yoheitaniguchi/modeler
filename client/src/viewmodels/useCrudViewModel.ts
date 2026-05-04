import { useCallback, useEffect, useState } from 'react';
import type { ModelDefinition, Record as ModelRecord } from '@modeler/shared';
import type { ApiClient } from '../services/api.js';
import { ApiError } from '../services/api.js';

/**
 * デプロイ済みモデルの CRUD 用 ViewModel。
 *
 * 1 つのモデルに対する list/create/update/delete をひとまとめにしている。
 * 画面ごとに ViewModel を 1 つ持つのが MVVM のセオリーで、ロジックの
 * 凝集度を上げて View をスッキリさせるのが目的。
 */

export interface CrudViewModel {
  records: ModelRecord[];
  loading: boolean;
  errors: string[];

  reload: () => Promise<void>;
  create: (input: Record<string, unknown>) => Promise<boolean>;
  update: (id: string, input: Record<string, unknown>) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
}

export function useCrudViewModel(api: ApiClient, model: ModelDefinition): CrudViewModel {
  const [records, setRecords] = useState<ModelRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [errors, setErrors] = useState<string[]>([]);

  const reload = useCallback(async () => {
    setLoading(true);
    setErrors([]);
    try {
      setRecords(await api.list(model.name));
    } catch (e) {
      setErrors(e instanceof ApiError ? e.toMessages() : [String(e)]);
    } finally {
      setLoading(false);
    }
  }, [api, model.name]);

  // モデルが切り替わった瞬間に最新データを取りに行く。
  // 依存に model.name を含めることで他モデルに切替→自動で再取得。
  useEffect(() => {
    void reload();
  }, [reload]);

  const create = useCallback(
    async (input: Record<string, unknown>): Promise<boolean> => {
      try {
        await api.create(model.name, input);
        await reload();
        return true;
      } catch (e) {
        setErrors(e instanceof ApiError ? e.toMessages() : [String(e)]);
        return false;
      }
    },
    [api, model.name, reload],
  );

  const update = useCallback(
    async (id: string, input: Record<string, unknown>): Promise<boolean> => {
      try {
        await api.update(model.name, id, input);
        await reload();
        return true;
      } catch (e) {
        setErrors(e instanceof ApiError ? e.toMessages() : [String(e)]);
        return false;
      }
    },
    [api, model.name, reload],
  );

  const remove = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        await api.remove(model.name, id);
        await reload();
        return true;
      } catch (e) {
        setErrors(e instanceof ApiError ? e.toMessages() : [String(e)]);
        return false;
      }
    },
    [api, model.name, reload],
  );

  return { records, loading, errors, reload, create, update, remove };
}
