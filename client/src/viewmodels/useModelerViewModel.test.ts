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
});
