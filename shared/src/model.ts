/**
 * モデル定義のスキーマ。
 *
 * direction.xml の要件:
 *   「データモデルを定義して保存を押下したら JSON で定義が出力できる」
 *
 * このファイルでは、その「データモデル」が何者なのかを TypeScript の型として
 * きちんと表現する。型を最初に固めるメリット:
 *   1. UI / API / 永続化の各層で「同じ概念」を共有できる
 *   2. 未知のフィールド型が混入したときにコンパイル時に気付ける
 *   3. JSON 入出力時のバリデーションが書きやすい (validation.ts 参照)
 */

/** サポートするフィールドの型。要件で string / number / boolean / date のみ。 */
export type FieldType = 'string' | 'number' | 'boolean' | 'date';

/** 1 つのフィールド (テーブルでいうカラム相当) の定義。 */
export interface FieldDefinition {
  /** プログラム上の識別子。英数とアンダースコアのみ (バリデーションで強制)。 */
  name: string;
  /** UI 表示用のラベル。日本語など自由記述。 */
  label: string;
  /** 値の型。 */
  type: FieldType;
  /** true なら NOT NULL 制約。空値を許さない。 */
  required: boolean;
  /** デフォルト値。新規作成時にこの値で埋める。型に応じた値、または undefined/null で「値なし」。 */
  defaultValue?: unknown;
}

/** 1 つのモデル (テーブル相当) の定義。 */
export interface ModelDefinition {
  /** モデル名。API パスや DAO のファイル名に使われるため英数のみ。 */
  name: string;
  /** UI 表示用のラベル。 */
  label: string;
  /** フィールド一覧。順序は UI の表示順序に使う。 */
  fields: FieldDefinition[];
}

/**
 * 保存・読込される JSON のルートスキーマ。
 *
 * version を持たせている理由:
 *   将来フィールド型を増やしたりスキーマを変えたとき、古い JSON を
 *   読み込む際にマイグレーションが必要になる。version があれば
 *   「v1 形式なら変換してから読む」といった分岐がきれいに書ける。
 */
export interface ModelDefinitionDocument {
  version: 1;
  models: ModelDefinition[];
}

/** 動的に生成されるレコード (CRUD 対象データ) の型。 */
export interface Record {
  /** DAO が採番する一意な ID。クライアントからは指定しない。 */
  id: string;
  /** その他は ModelDefinition.fields に従う動的フィールド。 */
  [key: string]: unknown;
}
