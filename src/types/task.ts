import { components } from './openapi';
import { StageData } from './stage';
import { Prettify } from './utils';

type UserMetadata = components['schemas']['userMetadata'];
type TaskPayload = components['schemas']['taskPayload'];
type TaskGenericProperties = 'userMetadata' | 'data';

export interface TaskData {
  userMetadata: UserMetadata;
  data: TaskPayload;
}

export type ValidTaskType<TaskTypes> = Extract<keyof TaskTypes, string> | (string & {});

export type InferTaskData<StageType, StageTypes extends { [K in keyof StageTypes]: StageData }> =
  StageType extends Extract<keyof StageTypes, string> ? StageTypes[StageType]['task'] : TaskData;

export type Task<TaskInfo extends TaskData = TaskData> = Prettify<
  Omit<components['schemas']['taskResponse'], TaskGenericProperties> & {
    userMetadata: TaskInfo['userMetadata'];
    data: TaskInfo['data'];
  }
>;

export type NewTask<TaskInfo extends TaskData = TaskData> = Prettify<
  Omit<components['schemas']['createTaskPayload'], TaskGenericProperties | 'tracestate' | 'traceparent'> & {
    userMetadata: TaskInfo['userMetadata'];
    data: TaskInfo['data'];
  }
>;
