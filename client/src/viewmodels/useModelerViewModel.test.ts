import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useModelerViewModel } from './useModelerViewModel.js';
import { createFakeApi } from '../tests/fakeApi.js';

/**
 * ViewModel を直接テストする。ここまで来ると React ツリーを描画する必要がなく、
 * 「状態 × 操作 → 期待値」を素直に書ける。
 */
describe('useModelerViewModel', () => {
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
    await act(async () => { ok = await result.current.deploy(); });
    expect(ok).toBe(true);
    expect(api._models).toHaveLength(1);
    expect(result.current.notice).toMatch(/デプロイ/);
  });
});
