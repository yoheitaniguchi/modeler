import type { ModelDefinitionDocument } from '@modeler/shared';
import { validateDocument } from '@modeler/shared';

/**
 * モデル設計の作業内容を localStorage に保持するサービス。
 *
 * 目的: ブラウザリロードやタブを誤って閉じても、JSON 保存忘れによる
 * 作業喪失を防ぐ。下書きはツールがバックグラウンドで保存し、起動時に
 * 「復元しますか?」と提示する。
 *
 * 設計上の判断:
 *   - localStorage が無効/満杯のときは黙って失敗する (try/catch)。
 *     下書きは「あれば嬉しい」程度の機能で、UX を阻害してはいけない。
 *   - models が空のドキュメントは保存しない。空状態を保存すると
 *     「下書きあり」バナーが永遠に出てしまう。
 */

export const DRAFT_KEY = 'modeler:draft:v1';

export function saveDraft(doc: ModelDefinitionDocument): void {
  try {
    if (doc.models.length === 0) {
      window.localStorage.removeItem(DRAFT_KEY);
      return;
    }
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(doc));
  } catch {
    /* localStorage が使えない環境では無視 */
  }
}

export function loadDraft(): ModelDefinitionDocument | null {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(DRAFT_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // JSON 構文エラーの下書きは破棄する (毎回同じエラーで詰まらないように)
    clearDraft();
    return null;
  }
  const result = validateDocument(parsed);
  if (!result.ok) {
    clearDraft();
    return null;
  }
  return parsed as ModelDefinitionDocument;
}

export function clearDraft(): void {
  try {
    window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* noop */
  }
}

export function hasDraft(): boolean {
  try {
    return window.localStorage.getItem(DRAFT_KEY) !== null;
  } catch {
    return false;
  }
}
