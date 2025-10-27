/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { Logger } from './logger';

export class NoopLogger implements Logger {
  public debug(obj: object, msg?: string, ...args: any[]): void {
    // No-op
  }

  public info(obj: object, msg?: string, ...args: any[]): void {
    // No-op
  }

  public warn(obj: object, msg?: string, ...args: any[]): void {
    // No-op
  }

  public error(obj: object, msg?: string, ...args: any[]): void {
    // No-op
  }
}
