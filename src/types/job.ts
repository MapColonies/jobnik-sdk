import { components } from './openapi';
import { Prettify } from './utils';

type UserMetadata = components['schemas']['userMetadata'];
type JobPayload = components['schemas']['jobPayload'];
type JobGenericProperties = 'userMetadata' | 'data';

export type JobTypesTemplate<JobTypes> = { [K in keyof JobTypes]: JobData };

export interface JobData {
  userMetadata: UserMetadata;
  data: JobPayload;
}

export type ValidJobType<JobTypes> = Extract<keyof JobTypes, string> | (string & {});

export type InferJobData<JobType, JobTypes> = JobType extends Extract<keyof JobTypes, string> ? JobTypes[JobType] : JobData;

export type Job<
  JobTypes extends JobTypesTemplate<JobTypes> = Record<string, JobData>,
  JobType extends ValidJobType<JobTypes> = 'unset',
  // JobInfo extends JobData = JobData,
> = Prettify<
  Omit<components['schemas']['job'], JobGenericProperties> & {
    // name: JobName;
    userMetadata?: InferJobData<JobType, JobTypes>['userMetadata'];
    data: InferJobData<JobType, JobTypes>['data'];
  }
>;

export type NewJob<
  JobTypes extends JobTypesTemplate<JobTypes> = Record<string, JobData>,
  JobType extends ValidJobType<JobTypes> = 'unset',
> = Prettify<
  Omit<components['schemas']['createJobPayload'], JobGenericProperties | 'tracestate' | 'traceparent'> & {
    // name: JobName;
    userMetadata?: InferJobData<JobType, JobTypes>['userMetadata'];
    data: InferJobData<JobType, JobTypes>['data'];
  }
>;
