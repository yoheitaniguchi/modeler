import { useCallback, useState } from 'react';

/**
 * Undo/Redo のための「過去・現在・未来」スタックを持つ汎用フック。
 *
 * 使い方:
 *   const h = useHistory(initialDoc);
 *   h.set(next);          // 履歴に push しつつ next を現在状態にする
 *   h.reset(next);        // 履歴を捨てて next にする (import 時など)
 *   h.undo() / h.redo();  // 戻る / 進む
 *
 * 設計上の判断:
 *   - 過去スタックの上限を 50 にして、長時間編集でメモリが肥大化するのを防ぐ。
 *   - reset は履歴をクリアする。「ファイル読込」「下書き復元」のように
 *     ユーザの意図的な切替を Undo の対象にすると混乱するため。
 */

export interface History<T> {
  state: T;
  set: (next: T | ((prev: T) => T)) => void;
  reset: (next: T) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

interface Snapshot<T> {
  past: T[];
  present: T;
  future: T[];
}

export const HISTORY_LIMIT = 50;

export function useHistory<T>(initial: T): History<T> {
  const [snap, setSnap] = useState<Snapshot<T>>({ past: [], present: initial, future: [] });

  const set = useCallback((next: T | ((prev: T) => T)) => {
    setSnap((s) => {
      const value =
        typeof next === 'function' ? (next as (p: T) => T)(s.present) : next;
      if (Object.is(value, s.present)) return s;
      const past = [...s.past, s.present];
      while (past.length > HISTORY_LIMIT) past.shift();
      return { past, present: value, future: [] };
    });
  }, []);

  const reset = useCallback((next: T) => {
    setSnap({ past: [], present: next, future: [] });
  }, []);

  const undo = useCallback(() => {
    setSnap((s) => {
      if (s.past.length === 0) return s;
      const last = s.past[s.past.length - 1];
      return {
        past: s.past.slice(0, -1),
        present: last,
        future: [s.present, ...s.future],
      };
    });
  }, []);

  const redo = useCallback(() => {
    setSnap((s) => {
      if (s.future.length === 0) return s;
      const next = s.future[0];
      return {
        past: [...s.past, s.present],
        present: next,
        future: s.future.slice(1),
      };
    });
  }, []);

  return {
    state: snap.present,
    set,
    reset,
    undo,
    redo,
    canUndo: snap.past.length > 0,
    canRedo: snap.future.length > 0,
  };
}
