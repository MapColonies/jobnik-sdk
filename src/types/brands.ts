declare const brand: unique symbol;

export type Brand<T, Brand extends string> = T & { [brand]: Brand };

export type JobId = Brand<string, 'JobId'>;
export type StageId = Brand<string, 'StageId'>;
export type TaskId = Brand<string, 'TaskId'>;
