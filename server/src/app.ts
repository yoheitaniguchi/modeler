import express, { type Express } from 'express';
import cors from 'cors';
import path from 'node:path';
import { promises as fsp, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DeployError, DeployRegistry, DestructiveChangeError } from './deploy/registry.js';
import { logger } from './services/logger.js';
import { getPool } from './db/pool.js';
import { dropTableForModel } from './db/schema.js';
import { getMessage, MSG } from '@modeler/shared';

/**
 * Express アプリのファクトリ関数。
 *
 * なぜ「アプリを返すだけの関数」にするか:
 *   - テストで supertest に渡すときに、起動済みサーバーではなく
 *     アプリインスタンスだけ渡せば良くなる (= ポート競合しない)。
 *   - データディレクトリをテストごとに切り替えられる (= 副作用を隔離)。
 */
export interface AppOptions {
  /**
   * クライアント配信ディレクトリ。指定された場合、その配下の静的ファイルを配信する (E2E / 本番モード)。
   */
  clientDistDir?: string;
}

function isForce(req: express.Request): boolean {
  return String(req.query.force ?? '').toLowerCase() === 'true';
}

export function createApp(options: AppOptions = {}): {
  app: Express;
  registry: DeployRegistry;
} {
  const app = express();
  app.use(cors()); // 開発用ツールなのでオリジン制限はしない
  app.use(express.json());

  const registry = new DeployRegistry();
  // /api/<modelName>/... に動的ルートをマウント
  registry.attach(app, '/api');

  // メタ API: 現在デプロイされているモデル一覧
  app.get('/meta/models', (_req, res) => {
    const models = registry.list();
    logger.debug('Fetched models list', { count: models.length });
    res.json({ models });
  });

  // メタ API: デプロイ (force=true で破壊的変更も許可)
  app.post('/meta/deploy', async (req, res) => {
    try {
      const force = isForce(req);
      logger.info('Deploying model', { modelName: req.body.name, force });
      const result = await registry.deploy(req.body, { force });
      logger.info('Model deployed successfully', { modelName: req.body.name });
      res.status(200).json(result);
    } catch (e) {
      if (e instanceof DestructiveChangeError) {
        logger.warn('Destructive change requires confirmation', { warnings: e.warnings });
        res.status(409).json({
          requiresConfirmation: true,
          warnings: e.warnings,
          changes: e.changes.map((c) => ({ kind: c.kind, field: c.field, detail: c.detail })),
        });
        return;
      }
      if (e instanceof DeployError) {
        logger.warn('Deployment validation failed', {
          modelName: req.body.name,
          errors: e.errors,
        });
        res.status(400).json({ errors: e.errors });
        return;
      }
      logger.error('Unexpected deployment error', e instanceof Error ? e : new Error(String(e)));
      res.status(500).json({ error: getMessage(MSG.HTTP_INTERNAL_ERROR) });
    }
  });

  app.put('/meta/models/:name', async (req, res) => {
    try {
      const force = isForce(req);
      logger.info('Updating model definition', { modelName: req.params.name, force });
      const updated = await registry.updateModel(req.params.name, req.body, { force });
      if (!updated) {
        logger.warn('Model update failed - model not found', { modelName: req.params.name });
        res.status(404).json({ errors: [getMessage(MSG.HTTP_MODEL_NOT_FOUND)] });
        return;
      }
      logger.info('Model definition updated successfully', { modelName: req.params.name });
      res.json({ model: updated.model, warnings: updated.warnings });
    } catch (e) {
      if (e instanceof DestructiveChangeError) {
        logger.warn('Destructive change requires confirmation', { warnings: e.warnings });
        res.status(409).json({
          requiresConfirmation: true,
          warnings: e.warnings,
          changes: e.changes.map((c) => ({ kind: c.kind, field: c.field, detail: c.detail })),
        });
        return;
      }
      if (e instanceof DeployError) {
        logger.warn('Model update validation failed', {
          modelName: req.params.name,
          errors: e.errors,
        });
        res.status(400).json({ errors: e.errors });
        return;
      }
      logger.error('Unexpected model update error', e instanceof Error ? e : new Error(String(e)));
      res.status(500).json({ error: getMessage(MSG.HTTP_INTERNAL_ERROR) });
    }
  });

  app.delete('/meta/models/:name', async (req, res) => {
    try {
      const force = isForce(req);
      logger.info('Deleting model', { modelName: req.params.name, force });
      const removed = await registry.removeModel(req.params.name, { force });
      if (removed) {
        logger.info('Model deleted successfully', { modelName: req.params.name });
        res.status(204).end();
      } else {
        logger.warn('Model deletion failed - model not found', { modelName: req.params.name });
        res.status(404).end();
      }
    } catch (e) {
      if (e instanceof DestructiveChangeError) {
        res.status(409).json({
          requiresConfirmation: true,
          warnings: e.warnings,
          changes: e.changes.map((c) => ({ kind: c.kind, field: c.field, detail: c.detail })),
        });
        return;
      }
      logger.error('Unexpected model delete error', e instanceof Error ? e : new Error(String(e)));
      res.status(500).json({ error: 'internal error' });
    }
  });

  app.post('/meta/logs', (req, res) => {
    const { level, message, data, error, stack } = req.body;
    logger.info('Client log received', {
      level,
      message,
      data,
      error,
      stack,
    });
    res.status(200).json({ status: 'ok' });
  });

  app.post('/test/echo', (req, res) => {
    res.json({ method: 'POST', body: req.body, ts: Date.now() });
  });
  app.get('/test/echo', (req, res) => {
    res.json({ method: 'GET', query: req.query, ts: Date.now() });
  });

  // E2E テスト用: 全モデルを削除しテーブルも DROP する。
  app.post('/test/reset', async (_req, res) => {
    logger.info('Resetting test environment');
    try {
      const pool = getPool();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const m of registry.list()) {
          await dropTableForModel(client, m.name, { cascade: true });
        }
        await client.query('COMMIT');
      } catch (e) {
        try { await client.query('ROLLBACK'); } catch { /* noop */ }
        throw e;
      } finally {
        client.release();
      }
      registry.reset();
      logger.info('Test environment reset completed');
    } catch (e) {
      logger.error('Error during test reset', e instanceof Error ? e : new Error(String(e)));
    }
    res.status(204).end();
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  const clientDistDir =
    options.clientDistDir ??
    process.env.CLIENT_DIST_DIR ??
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'client', 'dist');
  if (existsSync(clientDistDir)) {
    app.use(express.static(clientDistDir));
    app.use('/modeler', express.static(clientDistDir));
    app.get(/^\/(?!api|meta|test|health).*/, async (_req, res, next) => {
      try {
        const html = await fsp.readFile(path.join(clientDistDir, 'index.html'), 'utf-8');
        res.set('Content-Type', 'text/html').send(html);
      } catch (e) {
        next(e);
      }
    });
  }

  return { app, registry };
}
