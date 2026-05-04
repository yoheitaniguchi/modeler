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

    const next = express.Router();
    // 各 DAO の init() を待ってからスイッチすることで、
    // 半端な状態でリクエストが届くのを避ける。
    await Promise.all(
      doc.models.map(async (model) => {
        const { router, ready } = createCrudRouter(model, dataDir);
        await ready;
        next.use(`/${model.name}`, router);
      }),
    );

    this.current = next;
    this.deployed = doc.models;
    return { deployed: this.list() };
  }
}

export class DeployError extends Error {
  constructor(public readonly errors: string[]) {
    super(`Deploy failed: ${errors.join(', ')}`);
    this.name = 'DeployError';
  }
}
