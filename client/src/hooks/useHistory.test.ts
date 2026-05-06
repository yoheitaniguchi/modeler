import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HISTORY_LIMIT, useHistory } from './useHistory.js';

describe('useHistory', () => {
  it('set で値が変わり、過去スタックに前の値が積まれる', () => {
    const { result } = renderHook(() => useHistory(0));
    expect(result.current.canUndo).toBe(false);

    act(() => result.current.set(1));
    expect(result.current.state).toBe(1);
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
  });

  it('undo / redo で履歴を行き来できる', () => {
    const { result } = renderHook(() => useHistory('a'));
    act(() => result.current.set('b'));
    act(() => result.current.set('c'));

    act(() => result.current.undo());
    expect(result.current.state).toBe('b');
    expect(result.current.canRedo).toBe(true);

    act(() => result.current.undo());
    expect(result.current.state).toBe('a');
    expect(result.current.canUndo).toBe(false);

    act(() => result.current.redo());
    expect(result.current.state).toBe('b');
  });

  it('reset は履歴をクリアする', () => {
    const { result } = renderHook(() => useHistory(0));
    act(() => result.current.set(1));
    act(() => result.current.set(2));

    act(() => result.current.reset(99));
    expect(result.current.state).toBe(99);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it('新しい変更が入ると future はクリアされる', () => {
    const { result } = renderHook(() => useHistory(0));
    act(() => result.current.set(1));
    act(() => result.current.set(2));
    act(() => result.current.undo()); // state=1, future=[2]
    expect(result.current.canRedo).toBe(true);

    act(() => result.current.set(3));
    expect(result.current.state).toBe(3);
    expect(result.current.canRedo).toBe(false);
  });

  it('履歴サイズは HISTORY_LIMIT を超えない', () => {
    const { result } = renderHook(() => useHistory(0));
    for (let i = 1; i <= HISTORY_LIMIT + 5; i++) {
      act(() => result.current.set(i));
    }
    // 最古の値は捨てられるが、最新値・最後から HISTORY_LIMIT 件は undo で辿れる。
    // ここでは「Undo を HISTORY_LIMIT 回まで実行できる」ことだけ確認。
    for (let i = 0; i < HISTORY_LIMIT; i++) {
      expect(result.current.canUndo).toBe(true);
      act(() => result.current.undo());
    }
    expect(result.current.canUndo).toBe(false);
  });

  it('同じ値に set しても履歴は増えない', () => {
    const { result } = renderHook(() => useHistory(7));
    act(() => result.current.set(7));
    expect(result.current.canUndo).toBe(false);
  });
});
