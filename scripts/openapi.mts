import fs from 'node:fs/promises';
import { format, resolveConfig } from 'prettier';
import { dereference } from '@apidevtools/json-schema-ref-parser';
import type { OpenAPI3, OperationObject, ResponseObject, SchemaObject } from 'openapi-typescript';
import openapiTS, { astToString } from 'openapi-typescript';
import { factory } from 'typescript';

const OPENAPI_PATH = 'openapi3.yaml';
const ESLINT_DISABLE = '/* eslint-disable */\n';

const TYPES_DESTINATION_PATH = 'src/types/openapi.ts';
const ERRORS_DESTINATION_PATH = 'src/generated/openapi-errors.ts';
const prettierOptions = await resolveConfig('./src/index.ts');

const openapi = await fs.readFile(OPENAPI_PATH, 'utf-8');

async function createTypes(): Promise<void> {
  const ast = await openapiTS(openapi, {
    exportType: true,
    inject: 'import type { JobId, StageId, TaskId } from "./brands";',
    transform(schemaObject, metadata) {
      if (metadata.path === '#/components/schemas/taskId') {
        return factory.createTypeReferenceNode('TaskId', undefined);
      }
      if (metadata.path === '#/components/schemas/jobId') {
        return factory.createTypeReferenceNode('JobId', undefined);
      }
      if (metadata.path === '#/components/schemas/stageId') {
        return factory.createTypeReferenceNode('StageId', undefined);
      }
    },
  });

  let content = astToString(ast);

  content = ESLINT_DISABLE + content;

  content = await format(content, { ...prettierOptions, parser: 'typescript' });

  await fs.writeFile(TYPES_DESTINATION_PATH, content);

  console.log('Types generated successfully');
}

async function createErrors(): Promise<void> {
  const openapi = await dereference<OpenAPI3>(OPENAPI_PATH);

  if (openapi.paths === undefined) {
    console.error('No paths found in the OpenAPI document.');
    process.exit(1);
  }

  const errorCodes = new Set<string>();

  function extractCodeFromSchema(schema: SchemaObject): void {
    // Handle direct code property
    if (schema.type === 'object' && schema.properties?.code) {
      const codeProperty = schema.properties.code as SchemaObject;

      // Handle enum values
      if (codeProperty.enum) {
        codeProperty.enum.map(String).forEach((code) => {
          errorCodes.add(code);
        });
      }
    }

    // Handle allOf combinations
    if (schema.allOf) {
      for (const subSchema of schema.allOf) {
        extractCodeFromSchema(subSchema as SchemaObject);
      }
    }

    // Handle oneOf combinations
    if (schema.oneOf) {
      for (const subSchema of schema.oneOf) {
        extractCodeFromSchema(subSchema as SchemaObject);
      }
    }

    // Handle anyOf combinations
    if (schema.anyOf) {
      for (const subSchema of schema.anyOf) {
        extractCodeFromSchema(subSchema as SchemaObject);
      }
    }
  }

  for (const [, methods] of Object.entries(openapi.paths)) {
    for (const [key, operation] of Object.entries(methods) as [string, OperationObject][]) {
      if (['servers', 'parameters'].includes(key)) {
        continue;
      }

      for (const [statusCode, response] of Object.entries(operation.responses ?? {}) as [string, ResponseObject][]) {
        if (statusCode.startsWith('2') || statusCode.startsWith('3')) {
          continue; // Skip successful and redirection responses
        }

        const schema = response.content?.['application/json']?.schema as SchemaObject | undefined;
        if (schema) {
          extractCodeFromSchema(schema);
        }
      }
    }
  }

  if (errorCodes.size === 0) {
    console.warn('No error codes found in the OpenAPI document.');
    process.exit(0);
  }

  // let errorFile = "import { APIError } from '../errors';\n\n";

  // errorFile += errorCodes.values().map(createError).toArray().join('\n');

  let errorFile = `
  /* eslint-disable @typescript-eslint/naming-convention */
  export const API_ERRORS_MAP = { ${errorCodes
    .values()
    .map((code) => `'${code}': '${code}'`)
    .reduce((acc, curr) => `${acc}, ${curr}`)} } as const;
    /* eslint-enable @typescript-eslint/naming-convention */
`;

  errorFile = await format(errorFile, { ...prettierOptions, parser: 'typescript' });

  await fs.writeFile(ERRORS_DESTINATION_PATH, errorFile);

  console.log('Errors generated successfully');
}

await createTypes();

await createErrors();
