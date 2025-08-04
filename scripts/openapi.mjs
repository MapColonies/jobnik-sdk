import fs from 'node:fs/promises';
import { format, resolveConfig } from 'prettier';
import openapiTS, { astToString } from 'openapi-typescript';
import ts from 'typescript';

ts.factory.createIdent;

const OPENAPI_PATH = 'openapi3.yaml';
const DESTINATION_PATH = 'src/types/openapi.ts';

const ESLINT_DISABLE = '/* eslint-disable */\n';

const ast = await openapiTS(await fs.readFile(OPENAPI_PATH, 'utf-8'), {
  exportType: true,
  inject: 'import type { JobId, StageId, TaskId } from "./brands";',
  transform(schemaObject, metadata) {
    if (metadata.path === '#/components/schemas/taskId') {
      return ts.factory.createTypeReferenceNode('TaskId', undefined);
    }
    if (metadata.path === '#/components/schemas/jobId') {
      return ts.factory.createTypeReferenceNode('JobId', undefined);
    }
    if (metadata.path === '#/components/schemas/stageId') {
      return ts.factory.createTypeReferenceNode('StageId', undefined);
    }
  },
});

let content = astToString(ast);

content = ESLINT_DISABLE + content;

const prettierOptions = await resolveConfig('./src/index.ts');

content = await format(content, { ...prettierOptions, parser: 'typescript' });

await fs.writeFile(DESTINATION_PATH, content);

console.log('Types generated successfully');
