import express, { type Express } from 'express';
import cors from 'cors';
import path from 'node:path';
import { promises as fsp, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DeployError, DeployRegistry } from './deploy/registry.js';

/**
 * Express アプリのファクトリ関数。
 *
 * なぜ「アプリを返すだけの関数」にするか:
 *   - テストで supertest に渡すときに、起動済みサーバーではなく
 *     アプリインスタンスだけ渡せば良くなる (= ポート競合しない)。
 *   - データディレクトリをテストごとに切り替えられる (= 副作用を隔離)。
 */
export interface AppOptions {
  dataDir?: string;
  /** 設定された場合、その配下の静的ファイルを配信する (E2E / 本番モード)。 */
  clientDistDir?: string;
}

export function createApp(options: AppOptions = {}): {
  app: Express;
  registry: DeployRegistry;
  dataDir: string;
} {
  const dataDir =
    options.dataDir ??
    process.env.MODELER_DATA_DIR ??
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

  const app = express();
  app.use(cors()); // 開発用ツールなのでオリジン制限はしない
  app.use(express.json());

  const registry = new DeployRegistry();
  // /api/<modelName>/... に動的ルートをマウント
  registry.attach(app, '/api');

  // メタ API: 現在デプロイされているモデル一覧
  app.get('/meta/models', (_req, res) => {
    res.json({ models: registry.list() });
  });

  // メタ API: デプロイ
  app.post('/meta/deploy', async (req, res) => {
    try {
      const result = await registry.deploy(req.body, dataDir);
      res.status(200).json(result);
    } catch (e) {
      if (e instanceof DeployError) {
        res.status(400).json({ errors: e.errors });
        return;
      }
      // 想定外は 500。エラーメッセージは漏らさない方針。
      res.status(500).json({ error: 'internal error' });
    }
  });

  // メタ API: デプロイ済みモデルの定義更新 (再デプロイ・データ保持)
  app.put('/meta/models/:name', async (req, res) => {
    try {
      const updated = await registry.updateModel(req.params.name, req.body, dataDir);
      if (!updated) {
        res.status(404).json({ errors: ['model not found'] });
        return;
      }
      res.json({ model: updated });
    } catch (e) {
      if (e instanceof DeployError) {
        res.status(400).json({ errors: e.errors });
        return;
      }
      res.status(500).json({ error: 'internal error' });
    }
  });

  // メタ API: デプロイ済みモデルを削除
  app.delete('/meta/models/:name', (_req, res) => {
    const removed = registry.removeModel(_req.params.name);
    res.status(removed ? 204 : 404).end();
  });

  // E2E テスト用エコーエンドポイント (本番でも害は無いが必要なら NODE_ENV で切り分け)
  app.post('/test/echo', (req, res) => {
    res.json({ method: 'POST', body: req.body, ts: Date.now() });
  });
  app.get('/test/echo', (req, res) => {
    res.json({ method: 'GET', query: req.query, ts: Date.now() });
  });

  // E2E テスト用: 全モデルを削除しデータファイルも消す。
  // これがないと前のテストで作ったレコードが次のテストに紛れ込む。
  app.post('/test/reset', async (_req, res) => {
    for (const m of registry.list()) registry.removeModel(m.name);
    try {
      const entries = await fsp.readdir(dataDir);
      await Promise.all(
        entries
          .filter((n) => n.endsWith('.json'))
          .map((n) => fsp.rm(path.join(dataDir, n), { force: true })),
      );
    } catch {
      // ディレクトリが無い場合は無視
    }
    res.status(204).end();
  });

  // ヘルスチェック (環境構築テスト用)
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // E2E / 本番モード: client の build 成果物を同一サーバーから配信。
  // CLIENT_DIST_DIR 未指定時は ../../client/dist を見に行く (build 後に存在)。
  const clientDistDir =
    options.clientDistDir ??
    process.env.CLIENT_DIST_DIR ??
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'client', 'dist');
  if (existsSync(clientDistDir)) {
    app.use(express.static(clientDistDir));
    // SPA フォールバック: 既知の API パスでない GET は index.html を返す
    app.get(/^\/(?!api|meta|test|health).*/, async (_req, res, next) => {
      try {
        const html = await fsp.readFile(path.join(clientDistDir, 'index.html'), 'utf-8');
        res.set('Content-Type', 'text/html').send(html);
      } catch (e) {
        next(e);
      }
    });
  }

  return { app, registry, dataDir };
}
