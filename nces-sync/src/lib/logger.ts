export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug: (message: string, meta?: Record<string, unknown>) => void;
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
}

function format(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
  const ts = new Date().toISOString();
  const suffix = meta && Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  return `[${ts}] [${level.toUpperCase()}] ${message}${suffix}`;
}

export function createLogger(verbose = false): Logger {
  return {
    debug: (message, meta) => {
      if (verbose) console.debug(format('debug', message, meta));
    },
    info: (message, meta) => console.info(format('info', message, meta)),
    warn: (message, meta) => console.warn(format('warn', message, meta)),
    error: (message, meta) => console.error(format('error', message, meta)),
  };
}
