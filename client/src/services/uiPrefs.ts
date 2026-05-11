/**
 * UI 設定 (モード切替など) の localStorage 永続化。
 *
 * 設計上の判断:
 *   - サーバー側にユーザーモデル / 認証は無いので、設定は端末ローカルに保持する。
 *   - キーは v1 でバージョン付きにして、将来スキーマを変えても破壊しない。
 */

export type UiMode = 'admin' | 'user';

const MODE_KEY = 'modeler:ui:mode:v1';
const DEFAULT_MODE: UiMode = 'admin';

/** 永続化されたモードを取得する。値が無い/不正なら 'admin'。 */
export function loadMode(): UiMode {
  try {
    const raw = window.localStorage.getItem(MODE_KEY);
    return raw === 'admin' || raw === 'user' ? raw : DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

export function saveMode(mode: UiMode): void {
  try {
    window.localStorage.setItem(MODE_KEY, mode);
  } catch {
    // localStorage が使えない環境は無視 (機能が落ちるだけ)
  }
}
