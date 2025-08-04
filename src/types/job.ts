import { components } from './openapi';
import { Prettify } from './utils';

type UserMetadata = components['schemas']['userMetadata'];
type JobPayload = components['schemas']['jobPayload'];
type JobGenericProperties = 'userMetadata' | 'data' | 'name';

interface JobData {
  userMetadata: UserMetadata;
  data: JobPayload;
}

export type ValidJobName<JobTypes> = Extract<keyof JobTypes, string> | (string & {});

export type InferJobData<JobName, JobTypes> = JobName extends Extract<keyof JobTypes, string> ? JobTypes[JobName] : JobData;

export type JobTypesTemplate = Record<string, JobData>;

export type Job<JobName extends string, JobInfo extends JobData = JobData> = Prettify<
  Omit<components['schemas']['job'], JobGenericProperties> & {
    userMetadata: JobInfo['userMetadata'];
    data: JobInfo['data'];
    name: JobName;
  }
>;

export type NewJob<JobName extends string, JobInfo extends JobData = JobData> = Prettify<
  Omit<components['schemas']['createJobPayload'], JobGenericProperties> & {
    name: JobName;
    userMetadata: JobInfo['userMetadata'];
    data: JobInfo['data'];
  }
>;
