interface LogFn {
  (obj: object, message?: string, ...args: unknown[]): void;
}

export interface Logger {
  debug: LogFn;
  info: LogFn;
  warn: LogFn;
  error: LogFn;
}
