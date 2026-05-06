import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ModelDefinition, Record as ModelRecord } from '@modeler/shared';
import type { ApiClient } from '../services/api.js';
import { ApiError } from '../services/api.js';
import {
  applyFilters,
  applySort,
  type FilterMap,
  type SortDir,
} from '../services/filter.js';

/**
 * デプロイ済みモデルの CRUD 用 ViewModel。
 *
 * 1 つのモデルに対する list/create/update/delete をひとまとめにしている。
 * 検索・絞り込み・ソートはクライアント側で純粋関数 (services/filter) に委譲し、
 * UI 状態 (keyword/filters/sortBy/sortDir) を保持する。
 */

export interface CrudViewModel {
  records: ModelRecord[];
  filteredRecords: ModelRecord[];
  loading: boolean;
  errors: string[];

  keyword: string;
  filters: FilterMap;
  sortBy: string | null;
  sortDir: SortDir;

  setKeyword: (v: string) => void;
  setFilters: (v: FilterMap) => void;
  toggleSort: (fieldName: string) => void;

  reload: () => Promise<void>;
  create: (input: Record<string, unknown>) => Promise<boolean>;
  update: (id: string, input: Record<string, unknown>) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
}

export function useCrudViewModel(api: ApiClient, model: ModelDefinition): CrudViewModel {
  const [records, setRecords] = useState<ModelRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [errors, setErrors] = useState<string[]>([]);

  const [keyword, setKeyword] = useState<string>('');
  const [filters, setFilters] = useState<FilterMap>({});
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');

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

  // モデルが切り替わった瞬間に最新データを取りに行く + 検索条件もリセット
  useEffect(() => {
    setKeyword('');
    setFilters({});
    setSortBy(null);
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

  const toggleSort = useCallback((fieldName: string) => {
    setSortBy((prev) => {
      if (prev !== fieldName) {
        setSortDir('asc');
        return fieldName;
      }
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      return prev;
    });
  }, []);

  const filteredRecords = useMemo(() => {
    const filtered = applyFilters(records, model.fields, keyword, filters);
    const sortField =
      sortBy === null ? null : model.fields.find((f) => f.name === sortBy) ?? null;
    return applySort(filtered, sortField, sortDir);
  }, [records, model.fields, keyword, filters, sortBy, sortDir]);

  return {
    records,
    filteredRecords,
    loading,
    errors,
    keyword,
    filters,
    sortBy,
    sortDir,
    setKeyword,
    setFilters,
    toggleSort,
    reload,
    create,
    update,
    remove,
  };
}
