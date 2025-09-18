import { Worker } from './clients/worker';
import { Consumer } from './clients/consumer';
import { Producer } from './clients/producer';
import { createApiClient, type ApiClient } from './api';
import type { JobId, StageId, TaskId } from './types/brands';
import type { Logger } from './types';
import type { Job, JobData, NewJob } from './types/job';
import type { Stage, NewStage, StageData, ValidStageType } from './types/stage';
import type { Task, NewTask, InferTaskData } from './types/task';
import type { CircuitBreakerOptions, TaskHandler, TaskHandlerContext, WorkerOptions } from './types/worker';
import { HttpClientOptions } from './network/httpClient';
import { NoopLogger } from './telemetry/noopLogger';

export class JobnikSDK<
  JobTypes extends { [K in keyof JobTypes]: JobData } = Record<string, JobData>,
  StageTypes extends { [K in keyof StageTypes]: StageData } = Record<string, StageData>,
> {
  private readonly logger: Logger;
  private readonly apiClient: ApiClient;
  private readonly producer: Producer;
  private readonly consumer: Consumer<StageTypes>;

  public constructor(options: { baseUrl: string; httpClientOptions?: HttpClientOptions; logger?: Logger }) {
    this.logger = options.logger ?? new NoopLogger();
    this.apiClient = createApiClient(options.baseUrl, options.httpClientOptions);
    this.consumer = new Consumer(this.apiClient, this.logger);
    this.producer = new Producer(this.apiClient, this.logger);
  }

  public getConsumer(): Consumer<StageTypes> {
    return this.consumer;
  }

  public getProducer(): Producer<JobTypes, StageTypes> {
    return this.producer as unknown as Producer<JobTypes, StageTypes>;
  }

  public createWorker<StageType extends ValidStageType<StageTypes> = string>(
    taskHandler: TaskHandler<InferTaskData<StageType, StageTypes>, JobTypes, StageTypes>,
    stageType: StageType,
    options?: WorkerOptions
  ): Worker<StageTypes, StageType, JobTypes> {
    return new Worker<StageTypes, StageType, JobTypes>(taskHandler, stageType, options ?? {}, this.logger, this.apiClient, this.producer);
  }
}
