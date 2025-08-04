import { components } from './openapi';
import { TaskData } from './task';
import { Prettify } from './utils';

type UserMetadata = components['schemas']['userMetadata'];
type StagePayload = components['schemas']['stagePayload'];
type StageGenericProperties = 'userMetadata' | 'data' | 'type';

interface StageData {
  userMetadata: UserMetadata;
  data: StagePayload;
  task: TaskData;
}

export type ValidStageType<StageTypes> = Extract<keyof StageTypes, string> | (string & {});

export type InferStageData<StageType, StageTypes> = StageType extends Extract<keyof StageTypes, string> ? StageTypes[StageType] : StageData;

export type StageTypesTemplate = Record<string, StageData>;

export type Stage<StageType extends string, StageInfo extends StageData = StageData> = Prettify<
  Omit<components['schemas']['stageResponse'], StageGenericProperties> & {
    userMetadata: StageInfo['userMetadata'];
    data: StageInfo['data'];
    type: StageType;
  }
>;

export type NewStage<StageType extends string, StageInfo extends StageData = StageData> = Prettify<
  Omit<components['schemas']['createStagePayload'], StageGenericProperties> & {
    type: StageType;
    userMetadata: StageInfo['userMetadata'];
    data: StageInfo['data'];
  }
>;
