# Modeler マスタメンテナンス開発ツール システム仕様書

## 1. システム概要
本システムは、マスタメンテナンス画面を動的に生成するための開発支援ツールです。「データモデル」を定義し、それをデプロイすることで、該当モデルのCRUD操作画面およびREST APIを即座に生成・利用可能にします。また、設計したモデル定義はJSON形式で入出力できる機能を持ちます。

目的として、開発用ツールでありながらエンドユーザーにも直感的に操作できるUI/UXを提供し、学習用としてMVVMアーキテクチャやREST APIのベストプラクティスを示す役割も担います。

## 2. 技術スタック
本システムは、TypeScriptをベースとしたモノレポ構成（`client`, `server`, `shared`）で構築されています。

* **フロントエンド (`@modeler/client`)**: React 18, Vite
* **バックエンド (`@modeler/server`)**: Node.js, Express 4
* **共通モジュール (`@modeler/shared`)**: TypeScript (型定義およびバリデーションロジック)
* **テスト**: Vitest, React Testing Library, Supertest

## 3. アプリケーション・アーキテクチャ

システムは以下の3つのパッケージに分割されています。

### 3.1. 共通層 (`shared`)
* **責務**: クライアントとサーバー間で共有するデータモデルの型定義（スキーマ）と、そのバリデーションロジックを提供します。
* **主要コンポーネント**:
  * `model.ts`: フィールド定義（`FieldDefinition`）、モデル定義（`ModelDefinition`）、および保存用ルートドキュメント（`ModelDefinitionDocument`）の型を定義。
  * `validation.ts`: 共有のバリデーションロジック。

### 3.2. クライアント層 (`client`)
* **責務**: Reactを用いたシングルページアプリケーション（SPA）。ユーザーがデータモデルを設計し、デプロイ済みモデルのCRUD操作を行うUIを提供します。MVVM（Model-View-ViewModel）パターンを採用しています。
* **主要コンポーネント**:
  * **Views**:
    * `App.tsx`: ルートコンポーネント。「モデル設計」と「デプロイ済みモデル」のタブ切り替えを制御。
    * `ModelDesignerView.tsx`: データモデルの設計画面。
    * `DeployedModelsView.tsx`: デプロイされたモデルの一覧および操作画面。
    * `CrudView.tsx`: 各モデルに対するCRUD操作用UI。
  * **ViewModels**: コンポーネントの状態管理やAPI呼び出しのビジネスロジックをカプセル化（`useModelerViewModel.ts`, `useCrudViewModel.ts`）。
  * **Services**: HTTP通信層（`api.ts`）、ファイルのJSON入出力機能（`jsonIo.ts`）。

### 3.3. サーバー層 (`server`)
* **責務**: モデルのデプロイメント管理（メタAPI）および動的なCRUD REST APIを提供するExpressサーバー。データ永続化は PostgreSQL で実装されています。
* **主要コンポーネント**:
  * `app.ts`: Expressアプリケーションの設定。ヘルスチェックおよびメタAPI（`/meta/deploy`, `/meta/models`）のルーティング。`?force=true` で破壊的変更も適用。
  * `deploy/registry.ts`: 動的なAPIルーティングの生成・管理。`POST /meta/deploy` / `PUT /meta/models/:name` のタイミングで PostgreSQL に `CREATE TABLE` / `ALTER TABLE` を発行する。破壊的変更を検出した場合は `DestructiveChangeError` を投げ、HTTP 409 + 警告メッセージで応答する。
  * `db/schema.ts`: モデル定義から DDL を生成。`analyzeChanges` で新旧定義の差分と破壊性を判定。
  * `db/pool.ts`: `pg.Pool` のシングルトン。`DATABASE_URL` を `dotenv` 経由で読み込む。
  * `routes/crudRouter.ts`: 動的に生成される、単一モデルに対するCRUDエンドポイント。
  * `dao/postgresDao.ts`: Data Access Object。PostgreSQL に対する SQL を用いた読み書き、トランザクション制御、FK 整合性チェック（restrict/cascade/setNull）、ユニーク/主キー検証を担当。

### 環境セットアップ
1. `cp .env.example .env` で `DATABASE_URL` / `TEST_DATABASE_URL` を設定する
2. ローカル開発用に PostgreSQL を起動する場合は `docker compose -f docker-compose.dev.yml up -d`
3. `npm install`、`npm run dev`

## 4. データモデル仕様

### フィールド型 (`FieldType`)
以下の4つのデータ型をサポートしています。
* `string` (文字列)
* `number` (数値)
* `boolean` (真偽値)
* `date` (日付)

### モデル定義ドキュメントの構造 (JSON)
設計画面から保存・読み込みされるJSONは以下の構造を持ちます。
```json
{
  "version": 1,
  "models": [
    {
      "name": "モデルの識別子 (英数)",
      "label": "UI表示用のラベル",
      "fields": [
        {
          "name": "フィールド名",
          "label": "ラベル",
          "type": "string | number | boolean | date",
          "required": true,
          "defaultValue": "任意"
        }
      ],
      "ui": {
        "listTitle": "一覧タイトル",
        "detailTitle": "詳細タイトル",
        "createButtonLabel": "作成ボタン名"
      }
    }
  ]
}
```

## 5. API仕様

APIは大きく分けて「メタAPI」と「動的CRUD API」の2種類が存在します。

### 5.1. メタAPI (モデル管理)
* `GET /health` : サーバーのヘルスチェック
* `GET /meta/models` : 現在デプロイされているモデル一覧を取得
* `POST /meta/deploy` : 新しいモデル定義（`ModelDefinition`）をデプロイし、動的APIとストレージ領域を確保
* `DELETE /meta/models/:name` : デプロイ済みのモデル定義とエンドポイントを削除

### 5.2. 動的CRUD API
モデル名が `users` の場合、以下のエンドポイントが動的にマウントされます。
* `GET /api/users` : レコード一覧の取得
* `POST /api/users` : 新規レコードの作成（登録）
* `GET /api/users/:id` : 単一レコードの取得
* `PUT /api/users/:id` : レコードの更新
* `DELETE /api/users/:id` : レコードの削除

※すべての入力データは、`shared` 層のロジックを用いてDAO内でバリデーションされ、不正なデータは永続化されません。

## 6. データ永続化の仕様
現在の実装では、データは `JsonFileDao` を通じてローカルのファイルシステム（デフォルトでは `data/` 実行時ディレクトリ）に保存されます。
* 各モデルのデータは `[モデル名].json` というファイル名で保存されます。
* JSONファイルのフォーマットは、人間が閲覧しやすいようにインデント付き（2スペース）で出力されます。
* NodeJSのシングルスレッド特性を活かし、Promiseのチェーンを利用したシンプルな直列化によって書き込み競合を防止しています。
