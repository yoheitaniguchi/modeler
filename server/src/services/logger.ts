import pino from 'pino';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'node:fs';
import type { Logger as SharedLogger } from '@modeler/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logsDir = path.resolve(__dirname, '../../..', 'log');

// Ensure log directory exists so pino-file target does not fail with ENOENT
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const pinoLogger = pino(
  {
    level: process.env.LOG_LEVEL || 'info',
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  pino.transport({
    targets: [
      {
        target: 'pino/file',
        options: { destination: path.join(logsDir, 'server.log') },
      },
      {
        target: 'pino-pretty',
        options: {
          colorize: true,
          ignore: 'pid,hostname',
          singleLine: false,
        },
      },
    ],
  })
);

export const logger: SharedLogger = {
  debug: (message: string, data?: Record<string, unknown>) => {
    pinoLogger.debug(data || {}, message);
  },
  info: (message: string, data?: Record<string, unknown>) => {
    pinoLogger.info(data || {}, message);
  },
  warn: (message: string, data?: Record<string, unknown>) => {
    pinoLogger.warn(data || {}, message);
  },
  error: (message: string, error?: Error | Record<string, unknown>) => {
    if (error instanceof Error) {
      pinoLogger.error({ error: error.message, stack: error.stack }, message);
    } else {
      pinoLogger.error(error || {}, message);
    }
  },
};

export default logger;
