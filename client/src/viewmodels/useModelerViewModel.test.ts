import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useModelerViewModel } from './useModelerViewModel.js';
import { createFakeApi } from '../tests/fakeApi.js';
import { DRAFT_KEY } from '../services/draftStorage.js';

/**
 * ViewModel を直接テストする。ここまで来ると React ツリーを描画する必要がなく、
 * 「状態 × 操作 → 期待値」を素直に書ける。
 */
describe('useModelerViewModel', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it('addModel / addField でドキュメントを構築できる', () => {
    const { result } = renderHook(() => useModelerViewModel(createFakeApi()));
    act(() => result.current.addModel());
    act(() => result.current.updateModel(0, { name: 'customer', label: '顧客' }));
    act(() => result.current.updateField(0, 0, { name: 'fullName', label: '氏名', required: true }));

    const doc = result.current.document;
    expect(doc.models).toHaveLength(1);
    expect(doc.models[0].name).toBe('customer');
    expect(doc.models[0].fields[0].required).toBe(true);
  });

  it('addModel は __clientId を付与し、自動的に selectedKey に設定する', () => {
    const { result } = renderHook(() => useModelerViewModel(createFakeApi()));
    expect(result.current.selectedKey).toBeNull();

    act(() => result.current.addModel());
    const id1 = result.current.document.models[0].__clientId;
    expect(id1).toBeDefined();
    expect(result.current.selectedKey).toBe(id1);

    act(() => result.current.addModel());
    const id2 = result.current.document.models[1].__clientId;
    expect(id2).toBeDefined();
    expect(id2).not.toBe(id1);
    expect(result.current.selectedKey).toBe(id2);
  });

  it('select で selectedKey を変更できる', () => {
    const { result } = renderHook(() => useModelerViewModel(createFakeApi()));
    act(() => result.current.addModel());
    const id1 = result.current.document.models[0].__clientId!;
    act(() => result.current.addModel());
    expect(result.current.selectedKey).not.toBe(id1);

    act(() => result.current.select(id1));
    expect(result.current.selectedKey).toBe(id1);

    act(() => result.current.select(null));
    expect(result.current.selectedKey).toBeNull();
  });

  it('removeModel で選択中モデルが消えたら selectedKey が null に戻る', () => {
    const { result } = renderHook(() => useModelerViewModel(createFakeApi()));
    act(() => result.current.addModel());
    act(() => result.current.addModel());
    const id1 = result.current.document.models[0].__clientId!;
    act(() => result.current.select(id1));

    act(() => result.current.removeModel(0));
    expect(result.current.selectedKey).toBeNull();
  });

  it('removeModel で非選択モデルを消しても selectedKey は維持', () => {
    const { result } = renderHook(() => useModelerViewModel(createFakeApi()));
    act(() => result.current.addModel());
    act(() => result.current.addModel());
    const id2 = result.current.document.models[1].__clientId!;
    act(() => result.current.select(id2));

    act(() => result.current.removeModel(0));
    expect(result.current.selectedKey).toBe(id2);
  });

  it('replaceModel は既存の __clientId を保持する', () => {
    const { result } = renderHook(() => useModelerViewModel(createFakeApi()));
    act(() => result.current.addModel());
    const id = result.current.document.models[0].__clientId!;

    // 呼び出し側が __clientId を持たないモデルを渡しても保持されること
    act(() =>
      result.current.replaceModel(0, {
        name: 'customer',
        label: '顧客',
        fields: [{ name: 'a', label: 'A', type: 'string', required: false }],
      }),
    );
    expect(result.current.document.models[0].__clientId).toBe(id);
  });

  it('exportJson は __clientId をシリアライズに含めない', () => {
    const { result } = renderHook(() => useModelerViewModel(createFakeApi()));
    act(() => result.current.addModel());
    act(() => result.current.updateModel(0, { name: 'customer', label: '顧客' }));
    act(() =>
      result.current.updateField(0, 0, {
        name: 'a',
        label: 'A',
        type: 'string',
        required: false,
      }),
    );

    let json: string | null = null;
    act(() => {
      json = result.current.exportJson();
    });
    expect(json).not.toBeNull();
    expect(json!).not.toMatch(/__clientId/);
    // 復元できる形であること
    const parsed = JSON.parse(json!);
    expect(parsed.models[0].name).toBe('customer');
    expect(parsed.models[0].__clientId).toBeUndefined();
  });

  it('importJson は読み込んだモデルに __clientId を付与する', () => {
    const { result } = renderHook(() => useModelerViewModel(createFakeApi()));
    const json = JSON.stringify({
      version: 1,
      models: [
        {
          name: 'customer',
          label: '顧客',
          fields: [{ name: 'a', label: 'A', type: 'string', required: false }],
        },
      ],
    });
    act(() => {
      result.current.importJson(json);
    });
    expect(result.current.document.models[0].__clientId).toBeDefined();
    expect(result.current.selectedKey).toBe(result.current.document.models[0].__clientId);
  });

  it('deploy は __clientId を含まずに API へ送る', async () => {
    const api = createFakeApi();
    const { result } = renderHook(() => useModelerViewModel(api));
    act(() => result.current.addModel());
    act(() => result.current.updateModel(0, { name: 'customer', label: '顧客' }));
    act(() =>
      result.current.updateField(0, 0, {
        name: 'a',
        label: 'A',
        type: 'string',
        required: false,
      }),
    );

    await act(async () => {
      await result.current.deploy();
    });
    // FakeApi に保存されたモデルは __clientId を持たないこと
    expect(api._models).toHaveLength(1);
    expect((api._models[0] as { __clientId?: string }).__clientId).toBeUndefined();
  });

  it('exportJson は不正なドキュメントなら null + errors', () => {
    const { result } = renderHook(() => useModelerViewModel(createFakeApi()));
    // モデル 0 件の状態だと models 自体は空配列で許容されるので、
    // 「name 空のモデルを追加」して落ちることを確認する
    act(() => result.current.addModel());
    let json: string | null = '';
    act(() => { json = result.current.exportJson(); });
    expect(json).toBeNull();
    expect(result.current.errors.length).toBeGreaterThan(0);
  });

  it('importJson 正常系で document が置き換わる', () => {
    const { result } = renderHook(() => useModelerViewModel(createFakeApi()));
    const json = JSON.stringify({
      version: 1,
      models: [{
        name: 'customer', label: '顧客',
        fields: [{ name: 'name', label: '氏名', type: 'string', required: true }],
      }],
    });
    let ok = false;
    act(() => { ok = result.current.importJson(json); });
    expect(ok).toBe(true);
    expect(result.current.document.models[0].name).toBe('customer');
  });

  it('importJson 不正な JSON はエラー収集', () => {
    const { result } = renderHook(() => useModelerViewModel(createFakeApi()));
    let ok = true;
    act(() => { ok = result.current.importJson('{not json'); });
    expect(ok).toBe(false);
    expect(result.current.errors.length).toBeGreaterThan(0);
  });

  it('deploy は API を呼び出し、成功通知を立てる', async () => {
    const api = createFakeApi();
    const { result } = renderHook(() => useModelerViewModel(api));
    act(() => result.current.addModel());
    act(() => result.current.updateModel(0, { name: 'customer', label: '顧客' }));
    act(() => result.current.updateField(0, 0, {
      name: 'name', label: '氏名', type: 'string', required: true,
    }));

    let ok = false;
    await act(async () => {
      ok = await result.current.deploy();
    });
    expect(ok).toBe(true);
    expect(api._models).toHaveLength(1);
    expect(result.current.notice).toMatch(/デプロイ/);
  });

  it('Undo / Redo で編集前後を行き来できる', () => {
    const { result } = renderHook(() => useModelerViewModel(createFakeApi()));
    expect(result.current.canUndo).toBe(false);

    act(() => result.current.addModel());
    act(() => result.current.updateModel(0, { name: 'customer', label: '顧客' }));
    expect(result.current.canUndo).toBe(true);

    act(() => result.current.undo());
    expect(result.current.document.models[0].name).toBe('');

    act(() => result.current.undo());
    expect(result.current.document.models).toHaveLength(0);

    act(() => result.current.redo());
    expect(result.current.document.models).toHaveLength(1);
  });

  it('moveModel で並び順が変わり、undo で戻る', () => {
    const { result } = renderHook(() => useModelerViewModel(createFakeApi()));
    act(() => result.current.addModel());
    act(() => result.current.updateModel(0, { name: 'a', label: 'A' }));
    act(() => result.current.addModel());
    act(() => result.current.updateModel(1, { name: 'b', label: 'B' }));
    act(() => result.current.addModel());
    act(() => result.current.updateModel(2, { name: 'c', label: 'C' }));
    expect(result.current.document.models.map((m) => m.name)).toEqual(['a', 'b', 'c']);

    // 0 番目 (a) を末尾へ
    act(() => result.current.moveModel(0, 2));
    expect(result.current.document.models.map((m) => m.name)).toEqual(['b', 'c', 'a']);

    // undo で元に戻る
    act(() => result.current.undo());
    expect(result.current.document.models.map((m) => m.name)).toEqual(['a', 'b', 'c']);

    // redo で再び並び替え後へ
    act(() => result.current.redo());
    expect(result.current.document.models.map((m) => m.name)).toEqual(['b', 'c', 'a']);
  });

  it('moveModel は同一位置 / 範囲外で no-op', () => {
    const { result } = renderHook(() => useModelerViewModel(createFakeApi()));
    act(() => result.current.addModel());
    act(() => result.current.updateModel(0, { name: 'a', label: 'A' }));
    act(() => result.current.addModel());
    act(() => result.current.updateModel(1, { name: 'b', label: 'B' }));
    const before = result.current.document;

    act(() => result.current.moveModel(0, 0));
    expect(result.current.document).toBe(before);

    act(() => result.current.moveModel(-1, 1));
    expect(result.current.document).toBe(before);

    act(() => result.current.moveModel(0, 99));
    expect(result.current.document).toBe(before);
  });

  it('importJson は履歴をリセットする', () => {
    const { result } = renderHook(() => useModelerViewModel(createFakeApi()));
    act(() => result.current.addModel());
    act(() => result.current.updateModel(0, { name: 'a', label: 'A' }));
    expect(result.current.canUndo).toBe(true);

    act(() => {
      result.current.importJson(
        JSON.stringify({
          version: 1,
          models: [
            {
              name: 'b',
              label: 'B',
              fields: [{ name: 'x', label: 'X', type: 'string', required: false }],
            },
          ],
        }),
      );
    });
    expect(result.current.canUndo).toBe(false);
    expect(result.current.document.models[0].name).toBe('b');
  });

  it('document を変更すると debounce 後に下書きが保存される', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useModelerViewModel(createFakeApi()));
    act(() => result.current.addModel());
    act(() => result.current.updateModel(0, {
      name: 'customer',
      label: '顧客',
    }));
    act(() => result.current.updateField(0, 0, {
      name: 'name', label: '氏名', type: 'string', required: true,
    }));
    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull();

    act(() => { vi.advanceTimersByTime(500); });
    const raw = window.localStorage.getItem(DRAFT_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!).models[0].name).toBe('customer');
  });

  it('restoreDraft で localStorage の下書きを document に展開する', () => {
    window.localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        version: 1,
        models: [
          {
            name: 'restored',
            label: '復元',
            fields: [{ name: 'a', label: 'A', type: 'string', required: false }],
          },
        ],
      }),
    );
    const { result } = renderHook(() => useModelerViewModel(createFakeApi()));
    expect(result.current.draftAvailable).toBe(true);

    let ok = false;
    act(() => { ok = result.current.restoreDraft(); });
    expect(ok).toBe(true);
    expect(result.current.document.models[0].name).toBe('restored');
    expect(result.current.draftAvailable).toBe(false);
  });

  it('discardDraft で下書きが削除される', () => {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify({
      version: 1,
      models: [{ name: 'x', label: 'X', fields: [{ name: 'a', label: 'A', type: 'string', required: false }] }],
    }));
    const { result } = renderHook(() => useModelerViewModel(createFakeApi()));
    act(() => result.current.discardDraft());
    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull();
    expect(result.current.draftAvailable).toBe(false);
  });

  it('duplicateModel でモデルが複製され、名前が衝突しないように _copy が付加され、選択状態になる', () => {
    const { result } = renderHook(() => useModelerViewModel(createFakeApi()));
    act(() => result.current.addModel());
    act(() => result.current.updateModel(0, { name: 'customer', label: '顧客' }));

    act(() => result.current.duplicateModel(0));

    expect(result.current.document.models).toHaveLength(2);
    expect(result.current.document.models[1].name).toBe('customer_copy');
    expect(result.current.document.models[1].label).toBe('顧客_copy');

    const id2 = result.current.document.models[1].__clientId!;
    expect(result.current.selectedKey).toBe(id2);

    act(() => result.current.duplicateModel(0));
    expect(result.current.document.models).toHaveLength(3);
    expect(result.current.document.models[1].name).toBe('customer_copy2');
    expect(result.current.document.models[1].label).toBe('顧客_copy2');
  });

  it('破壊的変更 (409) を受けると destructiveWarnings がセットされ、confirmDestructiveDeploy で再送できる', async () => {
    const fakeApi = createFakeApi();
    const calls: Array<{ force: boolean }> = [];
    fakeApi.deploy = (async (_doc, opts) => {
      const force = opts?.force === true;
      calls.push({ force });
      if (!force) {
        const { ApiError } = await import('../services/api.js');
        throw new ApiError(409, {
          requiresConfirmation: true,
          warnings: ['カラム "age" を削除します'],
          changes: [{ kind: 'dropColumn', field: 'age', detail: 'カラム "age" を削除します' }],
        });
      }
      return { deployed: [], warnings: [] };
    }) as typeof fakeApi.deploy;

    const { result } = renderHook(() => useModelerViewModel(fakeApi));
    act(() => result.current.addModel());
    act(() => result.current.updateModel(0, { name: 'customer', label: '顧客' }));
    act(() => result.current.updateField(0, 0, { name: 'fullName', label: '氏名', type: 'string', required: true }));

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.deploy();
    });
    expect(ok).toBe(false);
    expect(result.current.destructiveWarnings).toEqual(['カラム "age" を削除します']);

    await act(async () => {
      ok = await result.current.confirmDestructiveDeploy();
    });
    expect(ok).toBe(true);
    expect(result.current.destructiveWarnings).toBeNull();
    expect(calls).toEqual([{ force: false }, { force: true }]);
  });

  it('cancelDestructiveDeploy で警告状態がクリアされる', async () => {
    const fakeApi = createFakeApi();
    fakeApi.deploy = (async () => {
      const { ApiError } = await import('../services/api.js');
      throw new ApiError(409, {
        requiresConfirmation: true,
        warnings: ['x'],
        changes: [],
      });
    }) as typeof fakeApi.deploy;

    const { result } = renderHook(() => useModelerViewModel(fakeApi));
    act(() => result.current.addModel());
    act(() => result.current.updateModel(0, { name: 'a', label: 'A' }));
    act(() => result.current.updateField(0, 0, { name: 'n', label: 'N' }));
    await act(async () => {
      await result.current.deploy();
    });
    expect(result.current.destructiveWarnings).toEqual(['x']);
    act(() => result.current.cancelDestructiveDeploy());
    expect(result.current.destructiveWarnings).toBeNull();
  });
});
