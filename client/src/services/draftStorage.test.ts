import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DRAFT_KEY,
  clearDraft,
  hasDraft,
  loadDraft,
  saveDraft,
} from './draftStorage.js';

const validDoc = {
  version: 1 as const,
  models: [
    {
      name: 'customer',
      label: '顧客',
      fields: [{ name: 'name', label: '氏名', type: 'string' as const, required: true }],
    },
  ],
};

describe('draftStorage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    window.localStorage.clear();
  });

  it('saveDraft → loadDraft でラウンドトリップできる', () => {
    saveDraft(validDoc);
    expect(hasDraft()).toBe(true);
    const restored = loadDraft();
    expect(restored).toEqual(validDoc);
  });

  it('models が空のドキュメントは保存されない (キーごと削除)', () => {
    saveDraft(validDoc);
    saveDraft({ version: 1, models: [] });
    expect(hasDraft()).toBe(false);
    expect(loadDraft()).toBeNull();
  });

  it('壊れた JSON は loadDraft で null を返し、キーが掃除される', () => {
    window.localStorage.setItem(DRAFT_KEY, '{not json');
    expect(loadDraft()).toBeNull();
    // 壊れた値が残ると毎回読み込みエラーになるので消えるべき
    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it('スキーマ違反の下書きは null を返す', () => {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ version: 999, models: [] }));
    expect(loadDraft()).toBeNull();
  });

  it('clearDraft で削除できる', () => {
    saveDraft(validDoc);
    clearDraft();
    expect(hasDraft()).toBe(false);
  });
});
