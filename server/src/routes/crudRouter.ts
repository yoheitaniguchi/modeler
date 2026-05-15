import { Router } from 'express';
import multer from 'multer';
import type { ModelDefinition, ImportFormat } from '@modeler/shared';
import { parseBulkImport, serializeRecords, formatErrorLog } from '@modeler/shared';
import type { Dao } from '../dao/dao.js';
import { DaoValidationError } from '../dao/dao.js';
import { PostgresDao } from '../dao/postgresDao.js';
import { getPool } from '../db/pool.js';

/**
 * 1 つのモデル定義から CRUD 用 Router を組み立てる。
 *
 * REST API の慣例にあわせている:
 *   GET    /              → 一覧
 *   GET    /:id           → 1 件取得
 *   POST   /              → 作成
 *   PUT    /:id           → 全置換更新
 *   DELETE /:id           → 削除
 *   POST   /import        → 一括インポート (multipart/form-data: file + format)
 *   GET    /export        → 一括エクスポート (?format=csv|tsv|json)
 *
 * なぜモデルごとに Router を分けるのか:
 *   - 各モデル用のミドルウェア (例: 認証, ロギング) を後から差し込みやすい。
 *   - app.use(`/api/${name}`, router) で簡単にマウントできる。
 *
 * エラーハンドリングは "throw" → "後段の error middleware" には流さず、
 * 各ハンドラ内で 400/404 を返している。理由はバリデーション結果のような
 * 業務エラーは「正常系の一部」として扱いたいから (500 ではない)。
 *
 * ルート登録の順序について:
 *   Express はルートを登録順に評価する。`GET /:id` はワイルドカードなので、
 *   それより前に /export のような固定パスを登録しないと /:id にマッチしてしまう。
 *   そのため /export と /import を /:id より先に登録している。
 */

/** multer: メモリに保存 (ファイルをディスクに書かない) */
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

export function createCrudRouter(model: ModelDefinition): {
  router: Router;
  ready: Promise<void>;
  dao: Dao;
} {
  const dao: Dao = new PostgresDao(model, getPool());
  const ready = dao.init();
  const router = Router();

  // ── 一覧 ──────────────────────────────────────────────────────────
  router.get('/', async (_req, res) => {
    res.json(await dao.list());
  });

  // ── 一括エクスポート ─────────────────────────────────────────────
  // GET /api/<model>/export?format=csv|tsv|json
  // NOTE: /:id より先に登録しないと "export" が id パラメータとして解釈される。
  router.get('/export', async (req, res) => {
    const format = (req.query['format'] as string | undefined) ?? 'csv';
    if (!['csv', 'tsv', 'json'].includes(format)) {
      res.status(400).json({ error: 'format must be csv, tsv, or json' });
      return;
    }
    const records = await dao.list();
    const content = serializeRecords(records, format as ImportFormat, model);
    const mimeMap: Record<string, string> = {
      csv: 'text/csv',
      tsv: 'text/tab-separated-values',
      json: 'application/json',
    };
    const ext = format;
    // ファイル名: {modelName}-{yyyymmdd}-{hhmmss}.{ext}
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const timestamp =
      `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
      `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const filename = `${model.name}${timestamp}.${ext}`;
    res.setHeader('Content-Type', `${mimeMap[format]}; charset=utf-8`);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(content);
  });

  // ── 一括インポート ──────────────────────────────────────────────
  // POST /api/<model>/import (multipart/form-data)
  //   - file: ファイル本体
  //   - format: "csv" | "tsv" | "json"
  // NOTE: /:id より先に登録しないと "import" が id パラメータとして解釈される。
  router.post('/import', upload.single('file'), async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'file is required' });
      return;
    }
    const format = (req.body as Record<string, string>)['format'] ?? 'csv';
    if (!['csv', 'tsv', 'json'].includes(format)) {
      res.status(400).json({ error: 'format must be csv, tsv, or json' });
      return;
    }

    const text = req.file.buffer.toString('utf-8');
    const result = parseBulkImport(text, format as ImportFormat, model);

    if (result.parseError) {
      res.status(422).json({
        parseError: result.parseError,
        rowErrors: result.rowErrors,
        errorLog: null,
      });
      return;
    }

    const created = [];
    const finalRowErrors = [...result.rowErrors];

    // エラーがなかった行を1件ずつ登録
    for (const record of result.records) {
      try {
        const r = await dao.create(record.data as Record<string, unknown>);
        created.push(r);
      } catch (e) {
        if (e instanceof DaoValidationError) {
          // 一意制約エラーなどを rowErrors に追加
          e.errors.forEach((msg) => {
            const colonIdx = msg.indexOf(':');
            const field = colonIdx !== -1 ? msg.slice(0, colonIdx).trim() : '(unknown)';
            const message = colonIdx !== -1 ? msg.slice(colonIdx + 1).trim() : msg;
            finalRowErrors.push({
              row: record.row,
              field,
              message,
              recordData: record.data,
            });
          });
        } else {
          throw e;
        }
      }
    }

    // 行番号順にソート
    finalRowErrors.sort((a, b) => a.row - b.row);

    // 成功したか、部分成功したかに関わらず 200/201 を返し、成功件数とエラー行を返す
    res.status(200).json({
      imported: created.length,
      records: created,
      rowErrors: finalRowErrors,
      errorLog: finalRowErrors.length > 0 ? formatErrorLog(finalRowErrors, model) : null,
    });
  });

  // ── 1 件取得 ─────────────────────────────────────────────────────
  router.get('/:id', async (req, res) => {
    const found = await dao.get(req.params.id);
    if (!found) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json(found);
  });

  // ── 作成 ─────────────────────────────────────────────────────────
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

  // ── 更新 ─────────────────────────────────────────────────────────
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

  // ── 削除 ─────────────────────────────────────────────────────────
  router.delete('/:id', async (req, res) => {
    try {
      const removed = await dao.remove(req.params.id);
      if (!removed) {
        res.status(404).json({ error: 'not found' });
        return;
      }
      res.status(204).end();
    } catch (e) {
      // restrict / noAction で被参照があり削除を阻止された場合などは
      // DaoValidationError として上がってくる。400 で返す。
      if (e instanceof DaoValidationError) {
        res.status(400).json({ errors: e.errors });
        return;
      }
      throw e;
    }
  });

  return { router, ready, dao };
}
