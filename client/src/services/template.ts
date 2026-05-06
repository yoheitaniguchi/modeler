/**
 * 簡易テンプレートエンジン。
 *  - `{{fieldName}}` を context のキーで置換
 *  - 値が無ければ空文字に置換
 *  - JSON 化済みの値 (string/number/boolean) をそのまま埋め込む。
 *
 * カスタムボタンの bodyTemplate を行データで展開する用途で使う。
 * View からも ViewModel からも純粋関数として使える。
 */

const VAR_PATTERN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

/** テンプレート文字列に context の値を埋め込む。 */
export function renderTemplate(
  template: string,
  context: Record<string, unknown>,
): string {
  return template.replace(VAR_PATTERN, (_, key: string) => {
    const v = context[key];
    if (v === undefined || v === null) return '';
    if (typeof v === 'string') return v;
    return JSON.stringify(v);
  });
}

/**
 * bodyTemplate を context で展開し JSON としてパース。
 *  - 空文字なら undefined を返す (= ボディ無しで送信)
 *  - JSON として不正なら例外 (UI でエラー表示)
 */
export function buildRequestBody(
  template: string | undefined,
  context: Record<string, unknown>,
): unknown {
  if (template === undefined || template.trim() === '') return undefined;
  const rendered = renderTemplate(template, context);
  try {
    return JSON.parse(rendered);
  } catch (e) {
    throw new TemplateError(
      `bodyTemplate を JSON としてパースできません: ${(e as Error).message}\n--- 展開後 ---\n${rendered}`,
    );
  }
}

export class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateError';
  }
}
