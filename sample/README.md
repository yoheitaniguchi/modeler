# Modeler — 画面サンプル (`/sample`)

新機能「ヘッダー・明細 (マスター・ディテール) レイアウト」の **実装着手前の確認用ダミー画面** です。
実装計画 [1-sparkling-wave.md](../../../Users/yopey/.claude/plans/1-sparkling-wave.md) の Phase 2 成果物。

## ファイル

| ファイル | 役割 |
|----------|------|
| `master-detail.html` | 上下分割マスター・ディテール画面のマークアップ |
| `master-detail.css` | スタイル (既存 `client` のカラーパレットに準拠) |
| `master-detail.js`  | ダミーデータと UI ロジック (本実装の参考になる挙動定義) |

## 起動方法

ビルド不要。ブラウザでファイルを開くだけで動きます。

- `master-detail.html` をダブルクリック
- もしくは: 任意のローカルサーバーで `c:\dev\modeler\sample\` を配信し `http://localhost:PORT/master-detail.html` にアクセス

## 確認できる仕様

このサンプルは、本実装後の `CrudView` (`layout: 'masterDetail'` 指定時) の **見た目と挙動の合意取り** に使います。

### レイアウト
- 上半分: ヘッダー (`orders`) 一覧 + 選択中ヘッダーの編集フォーム (折り畳み可)
- 下半分: 選択ヘッダーに紐づく明細 (`orderLines`) のインライン編集グリッド
- ヘッダー未選択時は下半分にプレースホルダ表示

### 操作
- ヘッダー行クリック → 下の明細グリッドが選択ヘッダーの明細に更新される
- ヘッダーフォームで「ヘッダーを更新」 → ヘッダーテーブル反映
- 「＋ 行追加」 → 空行を追加してインライン編集
- 明細各セルは編集可。商品列クリック → **検索可能なドロップダウンポップオーバー** が出現
- 商品選択時、`defaultPrice` を単価セルに自動コピー (デモ的なデフォルト値挙動)
- 「既存から…」ボタン → モーダルで全明細一覧を商品名で検索/絞り込み → 複数選択して新規行にコピー
- 「明細を保存」 → 表示中の明細セットを反映 (本実装では `POST /api/orderLines` 等にバッチ送信される想定)
- 「削除」 → 行削除 (本実装では未保存はそのまま、既存IDは保存時にサーバー側削除)

### データモデルの想定

```jsonc
{
  "version": 1,
  "models": [
    {
      "name": "orders",
      "label": "受注",
      "fields": [
        { "name": "id", "type": "id", "label": "受注ID", "required": true, "primaryKey": true },
        { "name": "customer", "type": "reference", "targetModel": "customers", "targetLabelField": "name", "label": "顧客", "required": true },
        { "name": "orderDate", "type": "date", "label": "受注日", "required": true }
      ],
      "ui": { "layout": "masterDetail", "listTitle": "受注ヘッダー" }
    },
    {
      "name": "orderLines",
      "label": "受注明細",
      "fields": [
        { "name": "id", "type": "id", "label": "明細ID", "required": true, "primaryKey": true },
        { "name": "order", "type": "reference", "targetModel": "orders", "label": "受注", "required": true, "onDelete": "cascade" },
        { "name": "product", "type": "reference", "targetModel": "products", "targetLabelField": "name", "label": "商品", "required": true },
        { "name": "quantity", "type": "number", "label": "数量", "required": true },
        { "name": "unitPrice", "type": "number", "label": "単価", "required": true }
      ],
      "parent": { "model": "orders", "via": "order" }
    }
  ]
}
```

## 受入基準との対応

このサンプルは、ユーザー指定の受入基準 4 項目の **デザイン/動作の正解** を示します。

| 受入基準 | このサンプルでの示し方 |
|---------|----------------------|
| 確認用の画面サンプルと同じデザインを画面で確認できる | この HTML/CSS をそのまま React コンポーネントに移植 |
| 確認用の画面サンプルと同じ仕様の動作をすることが確認できる | この JS で表現された挙動を本実装の `CrudView` で再現 |
| 画面のパターンが選ぶことが確認できる | 上部の「画面パターン」ラジオ (standard / masterDetail) で示唆 |
| e2e テストが問題なく実行できる | 本実装時、このサンプル相当の挙動を `e2e/tests/master-detail.spec.ts` で検証 |

> このサンプルは「動作の正解」を視覚化するためのモック。実コードへの直接コピペは想定せず、デザインと挙動の合意材料として使ってください。
