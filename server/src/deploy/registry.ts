import express, { type Express, type Router } from 'express';
import type { ModelDefinition, ModelDefinitionDocument } from '@modeler/shared';
import { validateDocument } from '@modeler/shared';
import { createCrudRouter } from '../routes/crudRouter.js';

/**
 * デプロイ済みモデルのレジストリ。
 *
 * 「デプロイボタン押下 → 動的にエンドポイントを生やす」をどう実装するか:
 *   Express 4 系には Router を後から差し替える公式 API がない。
 *   そこで一段間にラッパーミドルウェアを噛ませて、
 *   「現在の active な Router」をそのラッパーが毎回呼ぶ形にしている。
 *   こうすると再デプロイ時に Router を作り直して差し替えるだけで、
 *   外側の app には影響しない。
 *
 * トレードオフ:
 *   - app._router をいじる方法もあるが内部 API なので壊れやすい。
 *   - 完全な隔離が必要なら子プロセスを起こすやり方もあるが過剰。
 *   - 今回の用途 (開発用ツール) ではこの軽量な手法で十分。
 */
export class DeployRegistry {
  private current: Router = express.Router();
  private deployed: ModelDefinition[] = [];
  /** 各モデル名に対する Router を保持。DAO の再初期化を避けるため。 */
  private routerMap = new Map<string, Router>();

  /** Express にマウントする入口。一度マウントすれば以後の差し替えは自動反映。 */
  attach(app: Express, basePath: string): void {
    app.use(basePath, (req, res, next) => this.current(req, res, next));
  }

  list(): ModelDefinition[] {
    // 防御的コピー — 呼び出し側が誤って中身を書き換えないように。
    return this.deployed.map((m) => ({ ...m, fields: [...m.fields] }));
  }

  /**
   * 新しいドキュメントを受け取って、CRUD ルートを再構築する。
   * 既存データファイルは消さない (DAO の init はファイルがなければ作るだけ)。
   */
  async deploy(doc: ModelDefinitionDocument, dataDir: string): Promise<{
    deployed: ModelDefinition[];
  }> {
    const validation = validateDocument(doc);
    if (!validation.ok) {
      throw new DeployError(validation.errors);
    }

    // 新しい Router を作成し、各モデルのルートを登録
    const next = express.Router();
    const newRouterMap = new Map<string, Router>();

    // 各 DAO の init() を待ってからスイッチすることで、
    // 半端な状態でリクエストが届くのを避ける。
    await Promise.all(
      doc.models.map(async (model) => {
        const { router, ready } = createCrudRouter(model, dataDir);
        await ready;
        newRouterMap.set(model.name, router);
        next.use(`/${model.name}`, router);
      }),
    );

    this.current = next;
    this.deployed = doc.models;
    this.routerMap = newRouterMap;
    return { deployed: this.list() };
  }

  /**
   * デプロイ済みモデル 1 つを別の定義で差し替える。
   * - 同名モデルがなければ false を返す。
   * - 既存データファイルは保持。Router を作り直して current を再構築。
   * - フィールド削除/型変更時もデータは消さず、既存値はそのまま。
   *   (validateRecord は更新時のみ走るので、リスト取得は影響なし)
   */
  async updateModel(
    name: string,
    updated: ModelDefinition,
    dataDir: string,
  ): Promise<ModelDefinition | null> {
    const idx = this.deployed.findIndex((m) => m.name === name);
    if (idx === -1) return null;

    const validation = validateDocument({ version: 1, models: [updated] });
    if (!validation.ok) {
      throw new DeployError(validation.errors);
    }
    if (updated.name !== name) {
      throw new DeployError(['model.name does not match path']);
    }

    const { router, ready } = createCrudRouter(updated, dataDir);
    await ready;

    this.routerMap.set(name, router);
    this.deployed = this.deployed.map((m, i) => (i === idx ? updated : m));

    // current を再構築 (順序維持)
    const next = express.Router();
    for (const model of this.deployed) {
      const r = this.routerMap.get(model.name);
      if (r) next.use(`/${model.name}`, r);
    }
    this.current = next;
    return updated;
  }

  /**
   * デプロイ済みモデルを 1 つ削除する。
   * routerMap から削除し、残りモデルで this.current を再構築する。
   * データファイルは残す。
   */
  removeModel(name: string): boolean {
    const idx = this.deployed.findIndex((m) => m.name === name);
    if (idx === -1) return false;

    this.deployed = this.deployed.filter((_, i) => i !== idx);
    this.routerMap.delete(name);

    // 残りモデルの Router から新しい current を構築
    const next = express.Router();
    for (const model of this.deployed) {
      const router = this.routerMap.get(model.name);
      if (router) {
        next.use(`/${model.name}`, router);
      }
    }
    this.current = next;
    return true;
  }
}

export class DeployError extends Error {
  constructor(public readonly errors: string[]) {
    super(`Deploy failed: ${errors.join(', ')}`);
    this.name = 'DeployError';
  }
}
