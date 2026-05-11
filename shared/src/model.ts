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

/** サポートするフィールドの型。要件で string / number / boolean / date に加え、他モデルへの参照 reference を追加。 */
export type FieldType = 'string' | 'number' | 'boolean' | 'date' | 'reference';

/** 高度なバリデーション設定。 */
export interface FieldValidation {
  pattern?: string; // 正規表現パターン (string用)
  minLength?: number; // 最小文字数 (string用)
  maxLength?: number; // 最大文字数 (string用)
  min?: number; // 最小値 (number用)
  max?: number; // 最大値 (number用)
  unique?: boolean; // ユニーク制約 (重複禁止)
}

/** 入力フォーマッタ設定。 */
export interface FieldFormatters {
  trim?: boolean; // 前後の空白を削除
  fullWidthToHalfWidth?: boolean; // 全角英数字を半角に変換
}

/** リレーションのカーディナリティ。manyToMany は型としては受け入れるが現状ランタイム未対応。 */
export type RelationKind = 'oneToOne' | 'oneToMany' | 'manyToMany';

/** FK の onDelete / onUpdate に指定できる挙動。 */
export type ReferentialAction = 'restrict' | 'cascade' | 'setNull' | 'noAction';

/** リテラル配列。バリデーション / UI で網羅列挙に使う。 */
export const RELATION_KINDS: readonly RelationKind[] = ['oneToOne', 'oneToMany', 'manyToMany'];
export const REFERENTIAL_ACTIONS: readonly ReferentialAction[] = [
  'restrict',
  'cascade',
  'setNull',
  'noAction',
];

/** 各 prop が未指定だった場合の解釈に使うデフォルト。サーバー / SQL / UI で共有。 */
export const DEFAULT_RELATION_KIND: RelationKind = 'oneToMany';
export const DEFAULT_ON_DELETE: ReferentialAction = 'restrict';
export const DEFAULT_ON_UPDATE: ReferentialAction = 'noAction';

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
  /** type='string' フィールドの場合、selectbox の選択肢を取得する API エンドポイント。 */
  optionsUrl?: string;
  /** type='reference' の場合の参照先モデル名。 */
  targetModel?: string;
  /** type='reference' の場合に表示ラベルとして使う参照先モデルのフィールド名。 */
  targetLabelField?: string;
  /** type='reference' の場合のカーディナリティ。未指定は oneToMany 扱い。 */
  relationKind?: RelationKind;
  /** type='reference' の場合、参照先削除時の挙動。未指定は restrict 扱い。 */
  onDelete?: ReferentialAction;
  /** type='reference' の場合、参照先 ID 更新時の挙動。ID は UUID で不変のためランタイムでは無視、SQL DDL のみで意味を持つ。未指定は noAction 扱い。 */
  onUpdate?: ReferentialAction;
  /** バリデーションルール。 */
  validation?: FieldValidation;
  /** フォーマッタ設定。 */
  formatters?: FieldFormatters;
}

/** ボタンが行う動作。 */
export type ButtonAction =
  | { kind: 'builtin'; op: 'create' | 'update' | 'edit' | 'delete' }
  | {
      kind: 'http';
      method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
      url: string;
      /** リクエストボディの雛形 (JSON 文字列)。`{{field}}` を行データの値で置換する。 */
      bodyTemplate?: string;
      /** 押下時の確認メッセージ。 */
      confirmMessage?: string;
      /** レスポンスを新規タブで開くか。 */
      openResponseInNewTab?: boolean;
    };

/** カスタム/上書き対象ボタンの定義。 */
export interface ButtonDefinition {
  /** モデル内で一意な識別子。 */
  id: string;
  /** UI 上の表示ラベル。 */
  label: string;
  /** 'row'=各行ごと / 'screen'=画面ヘッダ */
  scope: 'row' | 'screen';
  /** 押下時の動作。 */
  action: ButtonAction;
  /** ボタンスタイル。 */
  style?: 'primary' | 'danger' | 'ghost';
}

/** 既存ボタン (作成/更新/削除) の URL 上書き設定。 */
export interface BuiltinButtonOverride {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
}

/** モデル単位での UI 設定。 */
export interface ModelUiConfig {
  /** 一覧画面のタイトル。未設定ならモデル.label を使う。 */
  listTitle?: string;
  /** 詳細/編集画面のタイトル。 */
  detailTitle?: string;
  /** 作成ボタンのラベル。 */
  createButtonLabel?: string;
  /** 保存ボタンのラベル。 */
  saveButtonLabel?: string;
  /** キャンセルボタンのラベル。 */
  cancelButtonLabel?: string;
  /** 検索ボタンのラベル。 */
  searchButtonLabel?: string;
  /** 追加カスタムボタン / 既存ボタン上書き含むボタン定義。 */
  buttons?: ButtonDefinition[];
  /** 既存 CRUD ボタン (作成/更新/削除) の送信先 URL を差し替える。 */
  builtinButtonOverrides?: {
    create?: BuiltinButtonOverride;
    update?: BuiltinButtonOverride;
    delete?: BuiltinButtonOverride;
  };
}

/** 1 つのモデル (テーブル相当) の定義。 */
export interface ModelDefinition {
  /** モデル名。API パスや DAO のファイル名に使われるため英数のみ。 */
  name: string;
  /** UI 表示用のラベル。 */
  label: string;
  /** フィールド一覧。順序は UI の表示順序に使う。 */
  fields: FieldDefinition[];
  /** モデル単位での UI 設定。 */
  ui?: ModelUiConfig;
  /** 論理削除を有効にするか。true の場合削除時に _deleted フラグを立てる。 */
  softDelete?: boolean;
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
  /** 論理削除フラグ。 */
  _deleted?: boolean;
  /** その他は ModelDefinition.fields に従う動的フィールド。 */
  [key: string]: unknown;
}
