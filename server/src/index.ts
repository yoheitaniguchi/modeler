import { createApp } from './app.js';
import { logger } from './services/logger.js';

/**
 * エントリーポイント。app.ts と分けている理由はテスト容易性 (createApp() が
 * Pure に近い形で返るので、ポートを開かずに supertest に渡せる)。
 */
const PORT = Number(process.env.PORT ?? 4000);
const { app } = createApp();

app.listen(PORT, () => {
  logger.info('Server startup', { port: PORT, url: `http://localhost:${PORT}` });
});
