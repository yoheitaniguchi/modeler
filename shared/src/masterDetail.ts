/**
 * ヘッダー・明細(マスター・ディテール)関係の解決ヘルパ。
 *
 * 親子関係は `ModelDefinition.parent` (明細側) に宣言される。
 * このモジュールは、ある時点のドキュメントを与えれば「誰がヘッダー / 誰が明細」を
 * 一貫した規則で取り出せるようにする。クライアント・サーバーの両方から利用する。
 */

import type { FieldDefinition, ModelDefinition, ModelDefinitionDocument } from './model.js';

/**
 * 与えたモデルが「ヘッダー」かどうか。
 * 「他のモデルから `parent.model` で指されている」= ヘッダーと定義する。
 *
 * 注意: layout = 'masterDetail' フラグそのものではなく、構造的な意味でのヘッダー判定。
 * UI で本当に上下分割を出すかどうかは layout 値も合わせて判断する。
 */
export function isHeaderModel(
  model: ModelDefinition,
  doc: ModelDefinitionDocument,
): boolean {
  return doc.models.some((m) => m.parent?.model === model.name);
}

/**
 * ヘッダーモデルの「直接の子(明細)モデル」一覧を返す。
 * 順序はドキュメント内の models 順を保つ (UI で安定した表示順を得るため)。
 */
export function getDetailModels(
  header: ModelDefinition,
  doc: ModelDefinitionDocument,
): ModelDefinition[] {
  return doc.models.filter((m) => m.parent?.model === header.name);
}

/**
 * 明細モデルから「親を指す FieldDefinition (= parent.via フィールド)」を返す。
 * parent 未指定 or via に対応する field が存在しないなら undefined。
 */
export function getParentField(
  detail: ModelDefinition,
): FieldDefinition | undefined {
  if (!detail.parent) return undefined;
  return detail.fields.find((f) => f.name === detail.parent!.via);
}

/**
 * モデルが「明細」(= parent を持つ) かどうか。
 */
export function isDetailModel(model: ModelDefinition): boolean {
  return model.parent !== undefined;
}
