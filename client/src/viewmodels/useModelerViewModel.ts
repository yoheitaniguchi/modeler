import { useCallback, useEffect, useRef, useState } from 'react';
import type { FieldDefinition, FieldType, ModelDefinition, ModelDefinitionDocument } from '@modeler/shared';
import { validateDocument } from '@modeler/shared';
import type { ApiClient } from '../services/api.js';
import { ApiError } from '../services/api.js';
import { parse, serialize } from '../services/jsonIo.js';
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
}

const emptyDoc: ModelDefinitionDocument = { version: 1, models: [] };

const newField = (): FieldDefinition => ({
  name: '',
  label: '',
  type: 'string',
  required: false,
  defaultValue: undefined,
});

const newModel = (): ModelDefinition => ({
  name: '',
  label: '',
  fields: [newField()],
});

/** 自動保存の間隔。短すぎると localStorage への書き込みが頻発し、長すぎると喪失リスクが増える。 */
const DRAFT_DEBOUNCE_MS = 400;

export function useModelerViewModel(api: ApiClient): ModelerViewModel {
  const history = useHistory<ModelDefinitionDocument>(emptyDoc);
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [draftAvailable, setDraftAvailable] = useState<boolean>(() => hasDraft());

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
    updateModels((m) => [...m, newModel()]);
  }, [updateModels]);

  const removeModel = useCallback(
    (index: number) => {
      updateModels((m) => m.filter((_, i) => i !== index));
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
      updateModels((m) => m.map((model, i) => (i === index ? next : model)));
    },
    [updateModels],
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
      history.reset(doc);
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
      await api.deploy(document);
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
    history.reset(draft);
    setDraftAvailable(false);
    setErrors([]);
    setNotice('下書きを復元しました');
    return true;
  }, [history]);

  const discardDraft = useCallback(() => {
    clearDraft();
    setDraftAvailable(false);
  }, []);

  return {
    document,
    errors,
    notice,
    addModel,
    removeModel,
    updateModel,
    replaceModel,
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
  };
}

/** 型補完のため、内部で使う FieldType を再エクスポート。 */
export type { FieldType };
