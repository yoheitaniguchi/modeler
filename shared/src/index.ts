/**
 * @modeler/shared — クライアントとサーバーで共有する「契約」を定義するモジュール。
 *
 * なぜ共有パッケージにするのか:
 * - フロントとバックで同じ型を使うことで、API のリクエスト/レスポンスの形が
 *   ずれた瞬間に TypeScript のコンパイルエラーで気付ける。
 * - 「どんなモデル定義が許されるか」というドメインの中心ルールを 1 箇所に
 *   集めると、後から仕様変更しても波及範囲を見失わない。
 */

export * from './model.js';
export * from './validation.js';
export * from './logger.js';
export * from './bulkImport.js';
export * from './masterDetail.js';
