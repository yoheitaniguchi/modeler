import type { Logger } from '@modeler/shared';

const LOG_STORAGE_KEY = 'modeler_logs';
const MAX_LOGS = 1000;

interface StoredLogEntry {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  data?: Record<string, unknown>;
  error?: string;
  stack?: string;
}

const getStoredLogs = (): StoredLogEntry[] => {
  try {
    const stored = localStorage.getItem(LOG_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
};

const saveLogs = (logs: StoredLogEntry[]) => {
  try {
    const limited = logs.slice(-MAX_LOGS);
    localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(limited));
  } catch {
    // localStorage might be full or disabled
  }
};

const addLogEntry = (level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: Record<string, unknown> | Error) => {
  const logs = getStoredLogs();
  const timestamp = new Date().toISOString();

  let entry: StoredLogEntry = {
    timestamp,
    level,
    message,
  };

  if (data) {
    if (data instanceof Error) {
      entry.error = data.message;
      entry.stack = data.stack;
    } else {
      entry.data = data;
    }
  }

  logs.push(entry);
  saveLogs(logs);
};

export const clientLogger: Logger = {
  debug: (message: string, data?: Record<string, unknown>) => {
    console.debug(`[DEBUG] ${message}`, data || {});
    addLogEntry('debug', message, data);
  },
  info: (message: string, data?: Record<string, unknown>) => {
    console.info(`[INFO] ${message}`, data || {});
    addLogEntry('info', message, data);
  },
  warn: (message: string, data?: Record<string, unknown>) => {
    console.warn(`[WARN] ${message}`, data || {});
    addLogEntry('warn', message, data);
  },
  error: (message: string, error?: Error | Record<string, unknown>) => {
    if (error instanceof Error) {
      console.error(`[ERROR] ${message}`, error);
      addLogEntry('error', message, error);
    } else {
      console.error(`[ERROR] ${message}`, error || {});
      addLogEntry('error', message, error);
    }
  },
};

export const getClientLogs = (): StoredLogEntry[] => {
  return getStoredLogs();
};

export const clearClientLogs = () => {
  localStorage.removeItem(LOG_STORAGE_KEY);
};

export default clientLogger;
