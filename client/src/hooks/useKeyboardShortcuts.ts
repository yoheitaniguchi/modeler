import { useEffect } from 'react';

/**
 * グローバルキーボードショートカットを登録するフック。
 *
 * - キー記述は `mod+s` `mod+shift+z` のように小文字 + 修飾キーアルファベット順。
 * - `mod` は Mac の Cmd / Win/Linux の Ctrl の両方にマッチ。
 * - 入力中 (input/textarea/contentEditable) で Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z は
 *   ブラウザ標準の入力 Undo/Redo を尊重するために素通しする。
 *   それ以外のショートカット (Ctrl+S 等) は入力中でも動かす。
 */

export interface ShortcutMap {
  [combo: string]: () => void;
}

export function useKeyboardShortcuts(map: ShortcutMap, enabled: boolean = true): void {
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      const combo = comboFromEvent(e);
      const fn = map[combo];
      if (!fn) return;

      if (isUndoComboInTextField(e, combo)) return; // ネイティブ動作を尊重

      e.preventDefault();
      fn();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [map, enabled]);
}

function comboFromEvent(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('mod');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey) parts.push('shift');
  // 文字キーのみ key を採用。修飾キー単独 ('Control' 等) は無視。
  if (!['Control', 'Meta', 'Alt', 'Shift'].includes(e.key)) {
    parts.push(e.key.toLowerCase());
  }
  return parts.join('+');
}

function isUndoComboInTextField(e: KeyboardEvent, combo: string): boolean {
  if (combo !== 'mod+z' && combo !== 'mod+y' && combo !== 'mod+shift+z') return false;
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return true;
  if (t.isContentEditable) return true;
  return false;
}
