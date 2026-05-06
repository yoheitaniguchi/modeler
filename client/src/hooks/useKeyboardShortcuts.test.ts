import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useKeyboardShortcuts } from './useKeyboardShortcuts.js';

function dispatchKey(opts: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  target?: HTMLElement;
}) {
  const ev = new KeyboardEvent('keydown', {
    key: opts.key,
    ctrlKey: opts.ctrlKey,
    metaKey: opts.metaKey,
    shiftKey: opts.shiftKey,
    altKey: opts.altKey,
    bubbles: true,
    cancelable: true,
  });
  if (opts.target) {
    opts.target.dispatchEvent(ev);
  } else {
    window.dispatchEvent(ev);
  }
  return ev;
}

describe('useKeyboardShortcuts', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('mod+s が登録されたハンドラを呼び、preventDefault する', () => {
    const onSave = vi.fn();
    renderHook(() => useKeyboardShortcuts({ 'mod+s': onSave }));
    const ev = dispatchKey({ key: 's', ctrlKey: true });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('Mac の Cmd でも動く (metaKey)', () => {
    const onSave = vi.fn();
    renderHook(() => useKeyboardShortcuts({ 'mod+s': onSave }));
    dispatchKey({ key: 's', metaKey: true });
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('mod+shift+z は redo にマッピングされる', () => {
    const redo = vi.fn();
    renderHook(() => useKeyboardShortcuts({ 'mod+shift+z': redo }));
    dispatchKey({ key: 'z', ctrlKey: true, shiftKey: true });
    expect(redo).toHaveBeenCalledTimes(1);
  });

  it('input/textarea にフォーカス中の Ctrl+Z は素通しする', () => {
    const undo = vi.fn();
    renderHook(() => useKeyboardShortcuts({ 'mod+z': undo }));
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    dispatchKey({ key: 'z', ctrlKey: true, target: input });
    expect(undo).not.toHaveBeenCalled();
  });

  it('input にフォーカス中でも Ctrl+S は動く', () => {
    const save = vi.fn();
    renderHook(() => useKeyboardShortcuts({ 'mod+s': save }));
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    dispatchKey({ key: 's', ctrlKey: true, target: input });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('未登録キーは無視', () => {
    const fn = vi.fn();
    renderHook(() => useKeyboardShortcuts({ 'mod+s': fn }));
    const ev = dispatchKey({ key: 'a', ctrlKey: true });
    expect(fn).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
  });

  it('enabled=false なら何もしない', () => {
    const fn = vi.fn();
    renderHook(() => useKeyboardShortcuts({ 'mod+s': fn }, false));
    dispatchKey({ key: 's', ctrlKey: true });
    expect(fn).not.toHaveBeenCalled();
  });
});
