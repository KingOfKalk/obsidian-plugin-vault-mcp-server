export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  data?: unknown;
}

export interface LoggerOptions {
  debugMode: boolean;
  accessKey: string;
  /**
   * Optional plain-text sink invoked once per emitted log line, after
   * level gating and access-key redaction. Used to persist log output
   * to `debug.log` for the Diagnostics surface (CR23).
   */
  sink?: (line: string) => void;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export class Logger {
  private module: string;
  private options: LoggerOptions;

  constructor(module: string, options: LoggerOptions) {
    this.module = module;
    this.options = options;
  }

  debug(message: string, data?: unknown): void {
    this.log('debug', message, data);
  }

  info(message: string, data?: unknown): void {
    this.log('info', message, data);
  }

  warn(message: string, data?: unknown): void {
    this.log('warn', message, data);
  }

  error(message: string, data?: unknown): void {
    this.log('error', message, data);
  }

  updateOptions(options: Partial<LoggerOptions>): void {
    this.options = { ...this.options, ...options };
  }

  private log(level: LogLevel, message: string, data?: unknown): void {
    const minLevel: LogLevel = this.options.debugMode ? 'debug' : 'info';
    if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[minLevel]) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      module: this.module,
      message: this.redact(message),
      ...(data !== undefined && { data: this.redactUnknown(data) }),
    };

    const json = JSON.stringify(entry);

    switch (level) {
      case 'debug':
      case 'info':
        // eslint-disable-next-line no-console
        console.log(json);
        break;
      case 'warn':
        // eslint-disable-next-line no-console
        console.warn(json);
        break;
      case 'error':
        // eslint-disable-next-line no-console
        console.error(json);
        break;
    }

    if (this.options.sink) {
      try {
        this.options.sink(formatPlainTextLine(entry));
      } catch {
        // Logging must never throw — swallow sink failures.
      }
    }
  }

  private redact(value: string): string {
    if (!this.options.accessKey || this.options.accessKey.length === 0) {
      return value;
    }
    return value.split(this.options.accessKey).join('[REDACTED]');
  }

  private redactUnknown(value: unknown): unknown {
    if (typeof value === 'string') {
      return this.redact(value);
    }
    if (typeof value === 'object' && value !== null) {
      if (Array.isArray(value)) {
        return value.map((item) => this.redactUnknown(item));
      }
      const result: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
        result[key] = this.redactUnknown(val);
      }
      return result;
    }
    return value;
  }
}

export function createLogger(module: string, options: LoggerOptions): Logger {
  return new Logger(module, options);
}

function formatPlainTextLine(entry: LogEntry): string {
  const level = entry.level.toUpperCase().padEnd(5, ' ');
  const base = `${entry.timestamp}  ${level}  [${entry.module}] ${entry.message}`;
  if (entry.data === undefined) {
    return base;
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(entry.data);
  } catch {
    serialized = '[unserializable]';
  }
  return `${base} ${serialized}`;
}
