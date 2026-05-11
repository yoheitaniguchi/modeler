# テーブル間リレーション定義機能の追加 — 実装計画 & タスク計画

**作成日:** 2026-05-11
**対象機能:** データ定義におけるテーブル間リレーションの定義
**ステータス:** 計画承認済み / 実装中

---

## Context

データ定義機能において、テーブル同士の「リレーション」を明示的に定義できるようにする。

**現状の認識:**
- `FieldDefinition` には既に `type: 'reference'` と `targetModel` / `targetLabelField` が存在し、UI 上のセレクトボックスやバリデーションは動作している。
- しかし「リレーション」としては未成熟で、以下が欠けている:
  - **カーディナリティ** (1:1, 1:N, N:N) の明示
  - **削除/更新時の挙動** (RESTRICT / CASCADE / SET NULL)
  - **クロスモデル整合性** — `targetModel` が実在するか、参照先 ID が実在するか、参照先削除時の連鎖、を誰もチェックしていない
  - **SQL DDL の FOREIGN KEY** — 現状 `reference` は単に `TEXT` として出力される

**今回の到達目標 (ユーザー確認済み):**
- 「コア + サーバー整合性」スコープ
- 既存 `reference` フィールドを **拡張する** (新規 `relations` 概念は作らない)
- カーディナリティ・FK 整合性チェック・SQL DDL の FK 出力までを実装
- ERD 可視化は本タスクの対象外 (後続タスク)
- N:N は本タスクでは未対応とし、明示的にエラーを返す (理由は §E)

**既存仕様への影響:** すべての新規プロパティを optional にし、デフォルト値の意味論を既存の暗黙挙動 (1:N / RESTRICT) と一致させることで、既存 JSON / E2E / 単体テストを無改変で通す。

---

## A. 改修 vs 新規作成 のリスク比較

### (採用) 既存 `reference` フィールドを拡張する

**メリット:**
- 既存ドキュメント (新規プロパティ未指定) は無改変で通る。マイグレーション不要。
- 既存 UI ([ModelEditor.tsx:297-320](../client/src/components/ModelEditor.tsx#L297-L320)) の「リレーション設定」エリアを延長するだけ。
- 概念的にも自然 — 「`reference` 型フィールド = 1 本の関係」がそのままカーディナリティ/onDelete のキャリアになる。
- 影響範囲が局所的で、コードベースの規模 (DAO 1 ファイル / sqlGenerator 1 ファイル / ModelEditor 1 ファイル) に対して妥当。

**デメリット (正直に):**
- N:N は本来「2 行の間」に存在する関係で、フィールド (= 1 行に紐づくカラム) に押し込むと無理が出る。本タスクでは N:N を defer して回避するが、将来再設計が必要になる可能性。
- 逆方向ナビゲーション (「この Customer を参照している Order 一覧」) はモデル全体を走査しないと得られない。ERD で必要になったときコストを払う。
- `FieldDefinition` 型がリレーション専用プロパティで膨らみ、純粋なカラムとリレーションの判別が読みづらくなる。

### (不採用) `ModelDefinition.relations` / `Document.relations` を新規追加する

**リスク:**
1. **二重定義問題:** 同じ関係を `field.targetModel` と `relations[]` の両方で表現することになり、整合性維持コストが発生する。「片方を真実とする」ルールを置いても、UI で同期する手間と認知負荷が増える。
2. **既存ドキュメントの移行コスト:** 既存 `reference` フィールドから `relations[]` を自動生成するパスが必要。マイグレータ + その単体テストが追加で必要。
3. **UI 再設計:** リレーション編集が「モデル編集とは別タブ/別画面」になり、React 側のコード/E2E が大きく増える。ユーザーの再学習コストも発生。
4. **オーバーキル:** ERD 可視化 (本タスク対象外) で本当に欲しくなる構造ではあるが、その時点で既存 `reference` から派生させれば足りる。先取りする利益がない。

**結論:** 本リポジトリ規模・スコープでは「既存 reference を拡張」が圧倒的に費用対効果が高い。新規概念は導入しない。

---

## B. 実装計画

### B-1. 型定義の追加 — [shared/src/model.ts](../shared/src/model.ts)

`FieldDefinition` に optional プロパティを 3 つ追加 (line 50 付近):

```ts
relationKind?: 'oneToOne' | 'oneToMany' | 'manyToMany';
onDelete?: 'restrict' | 'cascade' | 'setNull' | 'noAction';
onUpdate?: 'restrict' | 'cascade' | 'setNull' | 'noAction';
```

**命名理由:** `'1:1'` のようなコロン入りリテラルではなく JS 識別子としても扱える camelCase を採用する。grep しやすく、`switch` 文の網羅性チェックも効きやすい。

同ファイルにデフォルト定数をエクスポート:

```ts
export const DEFAULT_RELATION_KIND = 'oneToMany' as const;
export const DEFAULT_ON_DELETE = 'restrict' as const;
export const DEFAULT_ON_UPDATE = 'noAction' as const;

export const RELATION_KINDS = ['oneToOne', 'oneToMany', 'manyToMany'] as const;
export const REFERENTIAL_ACTIONS = ['restrict', 'cascade', 'setNull', 'noAction'] as const;
```

**後方互換性:** すべて optional。`relationKind` 未指定 = `oneToMany` 扱い。`onDelete` 未指定 = `restrict` 扱い。これは「既存挙動 = 暗黙的に N 側の所有者が単に消えても何も起きない」と異なるが、**整合性チェック自体が新規追加なので「既存挙動を壊す」のではなく「ない機能が増える」**。既存ドキュメントを `relationKind=oneToMany / onDelete=restrict` として読み直しても、整合性チェックがオンになる前は何も起きないため安全。Task 6 で初めて挙動として顕在化する。

### B-2. バリデーション — [shared/src/validation.ts](../shared/src/validation.ts)

**フィールド単位 (`validateFieldDefinition`, line 78 直後に追記):**

- `f.relationKind` が指定されていれば `RELATION_KINDS` のいずれかである必要があり、かつ `f.type === 'reference'` であること。
- `f.onDelete` / `f.onUpdate` が指定されていれば `REFERENTIAL_ACTIONS` のいずれか、かつ `f.type === 'reference'` であること。
- `relationKind === 'manyToMany'` の場合は `${path}.relationKind: 'manyToMany' is not yet supported` を push (ハードエラー)。型としては受け入れて将来互換にしつつ、ランタイムでは明示的に拒否する。
- `onDelete === 'setNull'` は `required: false` のフィールドにのみ許可 (required な FK に null は入れられないため整合性が壊れる)。

**クロスモデル整合性 (新規関数、`validateDocument` line 314 付近で呼び出す):**

`validateCrossModelReferences(doc)` を新設し、

1. `Map<modelName, Set<fieldName>>` を構築。
2. 各 `reference` フィールドについて:
   - `targetModel` が map に存在しなければ `document.models[i].fields[j].targetModel: "X" does not match any model in document` を push (ハードエラー)。
   - `targetLabelField` が指定されているのに対象モデルのフィールド集合に存在しなければ同様にハードエラー。

**判断:** ハードエラーとする。理由は「壊れた `targetModel` は今でも UI で空ドロップダウンとして実害が出ており、デプロイ時に弾く方が体験として明確に良い」。既存ドキュメントは皆まともな `targetModel` を持っているので退行なし (Task 3 でフィクスチャを監査)。

### B-3. サーバー整合性 — DAO + Registry の配線

**配線の論点:** `JsonFileDao` は今、自モデルしか知らない。FK 検査は他 DAO に問い合わせが必要。

**採用案: DAO レジストリを setter で後注入する**

新規 [server/src/dao/daoRegistry.ts](../server/src/dao/daoRegistry.ts) を作成:

```ts
export interface DaoRegistry {
  get(modelName: string): JsonFileDao | undefined;
  models(): ModelDefinition[];
}
```

**[server/src/dao/jsonFileDao.ts](../server/src/dao/jsonFileDao.ts) の変更:**

- コンストラクタは変更せず、`setRegistry(registry: DaoRegistry): void` メソッドを追加する。**(既存テストは DAO を直接 `new` しているため、コンストラクタを破壊的に変えると影響範囲が広がる。setter なら未呼び出しの場合は整合性チェックが no-op になる。)**
- 新規 private メソッド `checkReferentialIntegrity(input, options)`:
  - 自モデルの `reference` フィールドを走査し、値が空でなければ `this.registry?.get(field.targetModel)?.get(value)` で実在確認。
  - 見つからない場合 `DaoValidationError(['${field.name}: referenced ${targetModel} id "${value}" does not exist'])` を throw。
  - registry 未設定なら no-op。
  - `create` 内 `validateRecord` 直後、`update` も同様に呼び出す。
- `remove` を拡張:
  - `registry?.models()` を走査し、`reference` フィールドで `targetModel === this.model.name` のものを集める (= 自分への被参照箇所)。
  - 各被参照モデルの DAO に対し、そのフィールドが削除対象 ID を持つレコードを検索:
    - `onDelete ?? 'restrict'` が `'restrict'` または `'noAction'`: 1 件でもあれば `DaoValidationError(['cannot delete: ${otherModel}.${otherField} still references this id'])` を throw。
    - `'cascade'`: 各被参照レコードに対し `otherDao.remove(id, visited)` を呼ぶ (再帰)。循環参照を防ぐため `visited: Set<string>` (キー `"${model}:${id}"`) を引数で受け渡し、再訪したらスキップ。
    - `'setNull'`: 各被参照レコードに対し `otherDao.update(id, { ...current, [field.name]: null })` を呼ぶ。
- `onUpdate` は実害なし (ID は不変な UUID) なので runtime では無視する旨をコメントに残す。SQL DDL 出力にのみ使われる。

**[server/src/deploy/registry.ts](../server/src/deploy/registry.ts) の変更:**

- `createCrudRouter` の返り値を `{ router, ready, dao }` に変更し、DAO を取り出せるようにする。
- `DeployRegistry.deploy` で全 DAO を集めて `DaoRegistryImpl` を構築し、各 DAO に `setRegistry(...)` を呼ぶ。順序: 全 DAO の `init()` を待つ → registry 構築 → 各 DAO に注入。
- `updateModel` でも同様にレジストリを再構築 (deployed リストが書き換わるため)。
- `removeModel` でも残存 DAO 群に対しレジストリを再注入。
- レジストリ自体を `DeployRegistry` のフィールドとして保持する。

### B-4. SQL DDL — [client/src/services/sqlGenerator.ts](../client/src/services/sqlGenerator.ts)

`generateCreateTable` を拡張:

- カラム DDL を組んだ後、`reference` フィールド (かつ `targetModel` が設定済み) を走査して FK 制約行を追加。
- 出力形:
  - **PostgreSQL / SQLite**:
    ```sql
    CONSTRAINT "fk_{model}_{col}" FOREIGN KEY ("col") REFERENCES "targetModel"("id") ON DELETE {action} ON UPDATE {action}
    ```
  - **MS Access (Jet SQL)**:
    ```sql
    CONSTRAINT [fk_{model}_{col}] FOREIGN KEY ([col]) REFERENCES [targetModel]([id])
    ```
    Jet SQL は CREATE TABLE 内では `ON DELETE / ON UPDATE` をサポートしない。コメント行 `-- ON DELETE/UPDATE not supported in MS Access DDL` を直前に出力して透明性を確保。
- 値マッピング: `restrict → RESTRICT`, `cascade → CASCADE`, `setNull → SET NULL`, `noAction → NO ACTION`。
- `targetModel` の値はバリデーションを通過していれば必ず実在モデル名だが、SQL 生成側はクロスモデル知識を持たない。**今回は単表生成 (`SqlExportButton` はモデル単体出力)** なので、参照先テーブルが同じスクリプトで作成される保証はない。これは v1 の既知の制限としてドキュメント (コメント) に残す。複数モデルの依存順序生成は後続タスク。

### B-5. UI — [ModelEditor.tsx:297-320](../client/src/components/ModelEditor.tsx#L297-L320)

既存の「リレーション設定」展開行 (line 297-320) を拡張する。

- `ModelEditor` に optional prop `knownModelNames?: string[]` を追加。呼び出し元 (`ModelDesignerView`, `DeployedModelsView` 内 InlineModelEditor) で `document.models.map(m => m.name)` を渡す。
- `targetModel` の入力を `<input>` から `<select>` (with `knownModelNames` が与えられているとき) にする。空文字選択肢 + 各モデル名選択肢。`knownModelNames` 未提供時は従来の `<input>`。
- `targetModel` 値が `knownModelNames` に含まれない場合、赤字インラインヒント `参照先モデル "X" は存在しません` を表示。
- 新規セレクトボックス 3 つ:
  - `relationKind` (1:1 / 1:N / N:N (未実装と表示してdisabled))
  - `onDelete` (RESTRICT / CASCADE / SET NULL / NO ACTION)
  - `onUpdate` (同上)
- レイアウト: 既存の flex-column 内、`targetLabelField` の下に 3 連セレクトを横並びで配置 (`display: flex; gap: 0.4rem`)。`minWidth` を 200px → 280px に拡張。

```
リレーション設定
[ targetModel ▾ ]   (※"xyz" は存在しません ← inline-error)
[ targetLabelField ▾ ]
[ relationKind ▾ ] [ onDelete ▾ ] [ onUpdate ▾ ]
```

### B-6. 後方互換性チェックリスト

- [ ] 既存 `reference` フィールド (新プロパティ未指定) は B-2 の追加バリデーションを 1 つも触れない (gate されている)
- [ ] 既存 DAO 直接 `new` テストはコンストラクタ無変更で通る (setter 未呼び出し)
- [ ] 既存 `validateRecord` は変更しない (reference 値は引き続き string)
- [ ] 既存 SQL 出力は `targetModel` が未指定の reference (ありえないがガード) なら FK 制約を出さない
- [ ] 既存 E2E (`model-design.spec.ts`, `deployed-edit.spec.ts`, `bulk-import.spec.ts`) はフィクスチャ追加なしで通る

---

## C. タスク計画 (8 段階で進める根拠)

各タスクは独立にコミット/レビュー/ロールバック可能な粒度。**この順序で進める理由:** 型定義 → 単独層バリデーション → クロス層バリデーション → クライアント(独立) → サーバー配線 → サーバー整合性 → UI → E2E の順は、各段階で既存テストが緑のまま進める依存順序になっている。サーバー整合性(Task 6)が最もリスクが高いため、その前に配線だけ(Task 5)を切り出してロールバック容易性を確保している。

| # | タスク | 主な変更ファイル | 検証方法 | リスク |
|---|---|---|---|---|
| 1 | 型定義 + デフォルト定数 | `shared/src/model.ts` | `npm run build --workspace=shared`, `npm test` 全緑 | 極小 (純追加) |
| 2 | フィールド単位バリデーション | `shared/src/validation.ts`, `validation.test.ts` | 新規 unit テスト + 既存テスト全緑 | 低 |
| 3 | クロスモデル `validateCrossModelReferences` | `shared/src/validation.ts`, `validation.test.ts` | unit テスト 4 ケース (不在 targetModel / 不在 targetLabelField / 正常 / 旧形式) + `server/src/app.test.ts` 全緑。フィクスチャに不正 `targetModel` がないか事前監査 | 中 (フィクスチャ次第) |
| 4 | SQL DDL FK 出力 | `client/src/services/sqlGenerator.ts`, `sqlGenerator.test.ts` (新規ファイルの可能性) | unit テスト 3 方言 × cascade/restrict/setNull。手動: ブラウザで SQL ダウンロード → PG/SQLite で実行 | 中 (構文ミス) |
| 5 | DAO レジストリ配線 (整合性チェック未追加) | `server/src/dao/daoRegistry.ts` (新規), `jsonFileDao.ts` (setter のみ), `crudRouter.ts` (dao 返却), `deploy/registry.ts` (3 メソッドで配線) | サーバー起動 + 既存 `app.test.ts` 全緑 + 新規テスト「deploy 後に registry.get で DAO が返る」 | 中 |
| 6 | 整合性チェック (create/update/delete) | `jsonFileDao.ts`, `jsonFileDao.test.ts` | unit テスト: 不正 FK 作成 → 400 / restrict 削除 → 400 / cascade → 子削除 / setNull → null 化 / 循環で停止 | **高** (主要ロジック) |
| 7 | UI 拡張 (relationKind / onDelete / onUpdate / 未知モデルヒント / `knownModelNames` prop 伝播) | `ModelEditor.tsx`, `ModelDesignerView.tsx`, `DeployedModelsView.tsx` | 手動 UI 確認 + Vite 開発サーバーで実機確認 | 中 |
| 8 | E2E 追加 | `e2e/tests/relations.spec.ts` (新規) | `npm test --workspace=e2e` 全緑 | 低 |

**各タスクのロールバック:** すべて単一 PR/コミット単位で切り戻し可能。データファイルへの破壊的変更なし。Task 5 の `crudRouter` 戻り値変更だけは複数ファイル波及するが、Task 5 を revert すれば一気に戻る。

---

## D. 検証計画 (E2E)

### Unit テスト追加

- [shared/src/validation.test.ts](../shared/src/validation.test.ts)
  - 新 prop の positive / negative
  - `'manyToMany'` 明示拒否
  - クロスモデル不在 targetModel / 不在 targetLabelField / 正常 / 旧形式
- [server/src/dao/jsonFileDao.test.ts](../server/src/dao/jsonFileDao.test.ts)
  - 整合性チェック 5 ケース (B-3 参照)
  - registry 未設定 → 整合性チェックは no-op (後方互換)
- `client/src/services/sqlGenerator.test.ts` (存在しなければ新規作成)
  - 3 方言 × 4 onDelete 値の FK 出力
  - msaccess は ON DELETE 句なし + コメント行

### E2E テスト追加 — `e2e/tests/relations.spec.ts`

既存 [deployed-edit.spec.ts](../e2e/tests/deployed-edit.spec.ts) のパターンを踏襲:

1. `Department` モデルと `Employee.dept` (reference→Department, onDelete=restrict) を作成 → デプロイ
2. Department 1 件作成 → Employee で参照 → Department 削除試行 → 400 を確認
3. `Employee.dept` の onDelete を `cascade` に変更 → 再デプロイ → Department 削除 → Employee も消えている
4. `Employee.dept` を `required=false` + `onDelete=setNull` に変更 → 再デプロイ → Department 削除 → Employee.dept が null
5. 不正な FK ID で Employee 作成 API → 400
6. ModelEditor で存在しない targetModel を入力 → 赤字ヒントが出る

### 手動 UI 確認手順

1. `npm run dev` でサーバー + Vite を起動
2. `/design` で `Department` (name: string) と `Employee` (name: string, dept: reference→Department, onDelete=restrict) を作成
3. デプロイ → CRUD タブで 1 件ずつ作成し、関係を確認
4. Department 削除 → トースト/エラーで 400 が見える
5. onDelete を cascade/setNull に変更しながら 1〜4 を反復
6. SQL エクスポート → PostgreSQL で `FOREIGN KEY ("dept") REFERENCES "Department"("id") ON DELETE RESTRICT` を眼で確認
7. SQL エクスポート → MS Access で `CONSTRAINT [fk_Employee_dept] ...` + コメント行を確認
8. 既存の事前タスクで作った JSON ドキュメントをロード → そのままデプロイ → CRUD 動作することを確認 (後方互換)

---

## E. N:N について本タスクでは「defer」する判断

**結論:** 本タスクでは N:N をサポートしない。型としてはユニオンに含めるが、バリデーションで明示的に拒否する。

**理由:**
- 案 (i) 「reference 値を配列にする」 = `validateRecord` (line 348), `formatRecord` (line 410), `FieldInput` の `ReferenceField`, `sqlGenerator`, `parseBulkImport`, `checkUniqueConstraints` (jsonFileDao.ts:119) など 6+ 箇所に分岐が波及する。「コア + サーバー整合性」のスコープから明確に逸脱する。
- 案 (ii) 「自動生成中間テーブル」 = SQL の慣例には沿うが、ユーザーが直接編集しない「派生モデル」概念をサーバーとクライアント両方に持ち込む必要があり、設計面積が大きい。
- 案 (iii) defer = 型ユニオンに `'manyToMany'` を含めて将来互換性を担保しつつ、ランタイムは明示エラーで返す。1:1 / 1:N の品質に集中できる。

**将来 N:N を再着手するタイミング:** ERD 可視化タスク (本タスク対象外) と合わせて行うのが自然。その時点で案 (ii) 自動生成中間テーブルを推奨 — 中間テーブルもただの reference 持ちモデルなので、本タスクで構築する FK 整合性機構をそのまま流用できる。

---

## 改修対象ファイル一覧 (Critical Files)

- [shared/src/model.ts](../shared/src/model.ts) — 型定義拡張・定数エクスポート
- [shared/src/validation.ts](../shared/src/validation.ts) — フィールド + クロスモデル整合性
- [shared/src/validation.test.ts](../shared/src/validation.test.ts) — テスト追加
- [server/src/dao/jsonFileDao.ts](../server/src/dao/jsonFileDao.ts) — `setRegistry` + 整合性チェック + cascade/restrict/setNull
- `server/src/dao/daoRegistry.ts` — **新規**
- [server/src/dao/jsonFileDao.test.ts](../server/src/dao/jsonFileDao.test.ts) — テスト追加
- [server/src/routes/crudRouter.ts](../server/src/routes/crudRouter.ts) — 戻り値に `dao` を含める
- [server/src/deploy/registry.ts](../server/src/deploy/registry.ts) — レジストリ構築・配線
- [client/src/services/sqlGenerator.ts](../client/src/services/sqlGenerator.ts) — FK 出力
- `client/src/services/sqlGenerator.test.ts` — **新規** (存在しなければ)
- [client/src/components/ModelEditor.tsx](../client/src/components/ModelEditor.tsx) — UI 拡張・`knownModelNames` prop
- [client/src/views/ModelDesignerView.tsx](../client/src/views/ModelDesignerView.tsx) — `knownModelNames` 伝播
- [client/src/views/DeployedModelsView.tsx](../client/src/views/DeployedModelsView.tsx) — `knownModelNames` 伝播
- `e2e/tests/relations.spec.ts` — **新規** E2E
