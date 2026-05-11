import type { ModelDefinition, ModelDefinitionDocument } from '@modeler/shared';
import { validateDocument } from '@modeler/shared';

/**
 * JSON 入出力サービス。
 * direction.xml の「保存ボタンで JSON 出力 / 読み込みボタンで JSON 取り込み」を担当。
 *
 * 純粋関数として実装する理由:
 *   - 入力が string、出力が ModelDefinitionDocument という素直な変換だけ。
 *   - File API のような副作用は呼び出し側 (View) に任せて、ここでは扱わない。
 *     こうすると Node 環境のテストでも素直にテストできる。
 */

/**
 * ドキュメントからクライアント内部用フィールド (__clientId 等) を取り除く。
 * サーバー送信 / JSON 保存の直前で必ず通すこと。
 */
export function stripClientFields(doc: ModelDefinitionDocument): ModelDefinitionDocument {
  return {
    ...doc,
    models: doc.models.map(({ __clientId: _ignored, ...rest }) => rest as ModelDefinition),
  };
}

export function serialize(doc: ModelDefinitionDocument): string {
  return JSON.stringify(stripClientFields(doc), null, 2);
}

export function parse(text: string): ModelDefinitionDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new JsonParseError([`JSON 構文エラー: ${(e as Error).message}`]);
  }
  const result = validateDocument(parsed);
  if (!result.ok) {
    throw new JsonParseError(result.errors);
  }
  return parsed as ModelDefinitionDocument;
}

export class JsonParseError extends Error {
  constructor(public readonly errors: string[]) {
    super(errors.join('; '));
    this.name = 'JsonParseError';
  }
}

/**
 * ブラウザでファイルとしてダウンロードさせる。
 * View からはこの 1 関数を呼ぶだけ。テスト時はスパイで差し替える想定。
 */
export function downloadAsFile(
  filename: string,
  text: string,
  mimeType: string = 'application/octet-stream',
): void {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 150);
}
