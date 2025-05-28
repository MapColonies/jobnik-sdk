/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { Logger } from './logger';

export class NoopLogger implements Logger {
  public debug(message: string, ...args: any[]): void {
    // No-op
  }

  public info(message: string, ...args: any[]): void {
    // No-op
  }

  public warn(message: string, ...args: any[]): void {
    // No-op
  }

  public error(message: string, ...args: any[]): void {
    // No-op
  }
}
