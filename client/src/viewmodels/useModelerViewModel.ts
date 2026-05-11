import { useCallback, useEffect, useRef, useState } from 'react';
import type { FieldDefinition, FieldType, ModelDefinition, ModelDefinitionDocument } from '@modeler/shared';
import { validateDocument } from '@modeler/shared';
import type { ApiClient } from '../services/api.js';
import { ApiError } from '../services/api.js';
import { parse, serialize, stripClientFields } from '../services/jsonIo.js';
import { clearDraft, hasDraft, loadDraft, saveDraft } from '../services/draftStorage.js';
import { useHistory } from '../hooks/useHistory.js';

/**
 * MVVM の ViewModel。
 *
 * View (React コンポーネント) が直接モデル定義の配列を触ると、
 *   - 配列操作と UI 描画ロジックが密結合
 *   - テストするためにコンポーネントを描画しないといけない
 * という辛さがある。
 *
 * カスタムフックに「状態 + 状態を変える関数群」を切り出すと:
 *   - フックだけを単体テストできる (renderHook)
 *   - View は表示と入力ハンドリングに専念できる
 *
 * これが「View にロジックを書かない」という MVVM の利点を React で素直に実現する形。
 *
 * Undo/Redo とローカル下書き保存は本フックで一元管理する。Undo は useHistory に
 * 委譲、ドラフトは document 変更時に debounce して localStorage へ書き込む。
 */

export interface ModelerViewModel {
  document: ModelDefinitionDocument;
  errors: string[];
  notice: string | null;

  addModel: () => void;
  removeModel: (index: number) => void;
  updateModel: (index: number, patch: Partial<ModelDefinition>) => void;
  replaceModel: (index: number, next: ModelDefinition) => void;
  /** モデルの並び順を変える (from 番目を to 番目へ)。範囲外や同位置は no-op。undo 可能。 */
  moveModel: (from: number, to: number) => void;

  addField: (modelIndex: number) => void;
  removeField: (modelIndex: number, fieldIndex: number) => void;
  updateField: (modelIndex: number, fieldIndex: number, patch: Partial<FieldDefinition>) => void;

  exportJson: () => string | null;
  importJson: (text: string) => boolean;
  deploy: () => Promise<boolean>;

  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;

  /** ローカルストレージに前回の下書きが残っているか。復元バナーの表示判定用。 */
  draftAvailable: boolean;
  /** 下書きを document に復元する。成功すれば true。 */
  restoreDraft: () => boolean;
  /** 下書きを破棄する。バナーを閉じる用途。 */
  discardDraft: () => void;

  /** 現在選択されているモデルの __clientId。未選択なら null。 */
  selectedKey: string | null;
  /** 選択を変更する。null で「未選択」。 */
  select: (key: string | null) => void;
}

const emptyDoc: ModelDefinitionDocument = { version: 1, models: [] };

const newField = (): FieldDefinition => ({
  name: '',
  label: '',
  type: 'string',
  required: false,
  defaultValue: undefined,
});

const newClientId = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `cid-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const newModel = (): ModelDefinition => ({
  name: '',
  label: '',
  fields: [newField()],
  __clientId: newClientId(),
});

/** インポート/復元したドキュメントの全モデルに __clientId を割り当てる (なければ)。 */
const ensureClientIds = (doc: ModelDefinitionDocument): ModelDefinitionDocument => ({
  ...doc,
  models: doc.models.map((m) =>
    m.__clientId ? m : { ...m, __clientId: newClientId() },
  ),
});

/** 自動保存の間隔。短すぎると localStorage への書き込みが頻発し、長すぎると喪失リスクが増える。 */
const DRAFT_DEBOUNCE_MS = 400;

export function useModelerViewModel(api: ApiClient): ModelerViewModel {
  const history = useHistory<ModelDefinitionDocument>(emptyDoc);
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [draftAvailable, setDraftAvailable] = useState<boolean>(() => hasDraft());
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // document 更新時に debounce で下書き保存。models が空のときは saveDraft が削除側で動く。
  const document = history.state;
  const skipFirstSaveRef = useRef(true);
  useEffect(() => {
    if (skipFirstSaveRef.current) {
      skipFirstSaveRef.current = false;
      return;
    }
    const id = setTimeout(() => saveDraft(document), DRAFT_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [document]);

  // 「副作用なしの純粋関数で次状態を作って setState」というパターンを徹底。
  // こうすると history.set の関数型更新で済み、レースコンディションが起きにくい。
  const updateModels = useCallback(
    (mutator: (models: ModelDefinition[]) => ModelDefinition[]) => {
      history.set((prev) => ({ ...prev, models: mutator(prev.models) }));
    },
    [history],
  );

  const addModel = useCallback(() => {
    const m = newModel();
    updateModels((ms) => [...ms, m]);
    setSelectedKey(m.__clientId ?? null);
  }, [updateModels]);

  const removeModel = useCallback(
    (index: number) => {
      updateModels((m) => m.filter((_, i) => i !== index));
      // 削除後に selectedKey が無効になっていれば useEffect 側で null に解決される
    },
    [updateModels],
  );

  const updateModel = useCallback(
    (index: number, patch: Partial<ModelDefinition>) => {
      updateModels((m) => m.map((model, i) => (i === index ? { ...model, ...patch } : model)));
    },
    [updateModels],
  );

  const replaceModel = useCallback(
    (index: number, next: ModelDefinition) => {
      // 呼び出し側 (ModelEditor) は __clientId を意識しないので、既存のものを保つ
      updateModels((m) =>
        m.map((model, i) =>
          i === index ? { ...next, __clientId: model.__clientId ?? next.__clientId } : model,
        ),
      );
    },
    [updateModels],
  );

  const moveModel = useCallback(
    (from: number, to: number) => {
      // 履歴を汚さないため no-op はここで弾く (updateModels はスプレッドで新オブジェクトを作るため)
      if (from === to) return;
      history.set((prev) => {
        const m = prev.models;
        if (from < 0 || from >= m.length) return prev;
        if (to < 0 || to >= m.length) return prev;
        const next = m.slice();
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        return { ...prev, models: next };
      });
    },
    [history],
  );

  const addField = useCallback(
    (modelIndex: number) => {
      updateModels((m) =>
        m.map((model, i) =>
          i === modelIndex ? { ...model, fields: [...model.fields, newField()] } : model,
        ),
      );
    },
    [updateModels],
  );

  const removeField = useCallback(
    (modelIndex: number, fieldIndex: number) => {
      updateModels((m) =>
        m.map((model, i) =>
          i === modelIndex
            ? { ...model, fields: model.fields.filter((_, fi) => fi !== fieldIndex) }
            : model,
        ),
      );
    },
    [updateModels],
  );

  const updateField = useCallback(
    (modelIndex: number, fieldIndex: number, patch: Partial<FieldDefinition>) => {
      updateModels((m) =>
        m.map((model, i) => {
          if (i !== modelIndex) return model;
          return {
            ...model,
            fields: model.fields.map((f, fi) => {
              if (fi !== fieldIndex) return f;
              // type を変えたら required は維持。患者の意図を尊重。
              return { ...f, ...patch } as FieldDefinition;
            }),
          };
        }),
      );
    },
    [updateModels],
  );

  const exportJson = useCallback((): string | null => {
    const result = validateDocument(document);
    if (!result.ok) {
      setErrors(result.errors);
      setNotice(null);
      return null;
    }
    setErrors([]);
    setNotice('JSON を生成しました');
    return serialize(document);
  }, [document]);

  const importJson = useCallback((text: string): boolean => {
    try {
      const doc = parse(text);
      // import はユーザの意図的な切替なので履歴をリセット。
      // 取り込んだ JSON には __clientId が無いので付与する。
      const withIds = ensureClientIds(doc);
      history.reset(withIds);
      if (withIds.models.length > 0) {
        setSelectedKey(withIds.models[0].__clientId ?? null);
      } else {
        setSelectedKey(null);
      }
      setErrors([]);
      setNotice('JSON を読み込みました');
      return true;
    } catch (e) {
      setErrors(e instanceof Error && 'errors' in e ? (e as { errors: string[] }).errors : [String(e)]);
      setNotice(null);
      return false;
    }
  }, [history]);

  const deploy = useCallback(async (): Promise<boolean> => {
    const result = validateDocument(document);
    if (!result.ok) {
      setErrors(result.errors);
      setNotice(null);
      return false;
    }
    try {
      // __clientId はサーバーに送らない
      await api.deploy(stripClientFields(document));
      setErrors([]);
      setNotice('デプロイしました');
      return true;
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(e.toMessages());
      } else {
        setErrors([String(e)]);
      }
      setNotice(null);
      return false;
    }
  }, [api, document]);

  const restoreDraft = useCallback((): boolean => {
    const draft = loadDraft();
    if (!draft) {
      setDraftAvailable(false);
      return false;
    }
    // 旧バージョンの下書きには __clientId が無い可能性があるので保険で付与。
    const withIds = ensureClientIds(draft);
    history.reset(withIds);
    if (withIds.models.length > 0) {
      setSelectedKey(withIds.models[0].__clientId ?? null);
    } else {
      setSelectedKey(null);
    }
    setDraftAvailable(false);
    setErrors([]);
    setNotice('下書きを復元しました');
    return true;
  }, [history]);

  const discardDraft = useCallback(() => {
    clearDraft();
    setDraftAvailable(false);
  }, []);

  const select = useCallback((key: string | null) => {
    setSelectedKey(key);
  }, []);

  // 選択中モデルが削除/インポートで消えたら null に戻す
  useEffect(() => {
    if (selectedKey === null) return;
    const stillExists = document.models.some((m) => m.__clientId === selectedKey);
    if (!stillExists) setSelectedKey(null);
  }, [document, selectedKey]);

  return {
    document,
    errors,
    notice,
    addModel,
    removeModel,
    updateModel,
    replaceModel,
    moveModel,
    addField,
    removeField,
    updateField,
    exportJson,
    importJson,
    deploy,
    undo: history.undo,
    redo: history.redo,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    draftAvailable,
    restoreDraft,
    discardDraft,
    selectedKey,
    select,
  };
}

/** 型補完のため、内部で使う FieldType を再エクスポート。 */
export type { FieldType };
