type LogFn = {
  (obj: object, message?: string, ...args: any[]): void;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface Logger {
  debug: LogFn;
  info: LogFn;
  warn: LogFn;
  error: LogFn;
}
