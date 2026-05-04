import { Router } from 'express';
import type { ModelDefinition } from '@modeler/shared';
import { DaoValidationError, JsonFileDao } from '../dao/jsonFileDao.js';

/**
 * 1 つのモデル定義から CRUD 用 Router を組み立てる。
 *
 * REST API の慣例にあわせている:
 *   GET    /              → 一覧
 *   GET    /:id           → 1 件取得
 *   POST   /              → 作成
 *   PUT    /:id           → 全置換更新
 *   DELETE /:id           → 削除
 *
 * なぜモデルごとに Router を分けるのか:
 *   - 各モデル用のミドルウェア (例: 認証, ロギング) を後から差し込みやすい。
 *   - app.use(`/api/${name}`, router) で簡単にマウントできる。
 *
 * エラーハンドリングは "throw" → "後段の error middleware" には流さず、
 * 各ハンドラ内で 400/404 を返している。理由はバリデーション結果のような
 * 業務エラーは「正常系の一部」として扱いたいから (500 ではない)。
 */
export function createCrudRouter(model: ModelDefinition, dataDir: string): {
  router: Router;
  ready: Promise<void>;
} {
  const dao = new JsonFileDao(model, dataDir);
  const ready = dao.init();
  const router = Router();

  router.get('/', async (_req, res) => {
    res.json(await dao.list());
  });

  router.get('/:id', async (req, res) => {
    const found = await dao.get(req.params.id);
    if (!found) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json(found);
  });

  router.post('/', async (req, res) => {
    try {
      const created = await dao.create(req.body ?? {});
      res.status(201).json(created);
    } catch (e) {
      if (e instanceof DaoValidationError) {
        res.status(400).json({ errors: e.errors });
        return;
      }
      throw e;
    }
  });

  router.put('/:id', async (req, res) => {
    try {
      const updated = await dao.update(req.params.id, req.body ?? {});
      if (!updated) {
        res.status(404).json({ error: 'not found' });
        return;
      }
      res.json(updated);
    } catch (e) {
      if (e instanceof DaoValidationError) {
        res.status(400).json({ errors: e.errors });
        return;
      }
      throw e;
    }
  });

  router.delete('/:id', async (req, res) => {
    const removed = await dao.remove(req.params.id);
    if (!removed) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.status(204).end();
  });

  return { router, ready };
}
