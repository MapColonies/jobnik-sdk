import tsBaseConfig, { namingConventions } from '@map-colonies/eslint-config/ts-base';
import jestConfig from '@map-colonies/eslint-config/jest';
import { config } from '@map-colonies/eslint-config/helpers';

const SemanticConventionsExtension = {
  // selector: 'objectLiteralProperty',
  format: null,
  filter: {
    match: true,
    regex: '^(_)$',
  },
};

// Create a new array with the base rules and our custom rule
const namingConvention = [...namingConventions, SemanticConventionsExtension];

const customConfig = {
  rules: {
    '@typescript-eslint/naming-convention': namingConvention,
    'no-console': 'error',
  },
  languageOptions: {
    parserOptions: {
      project: './tsconfig.json',
    },
  },
};

export default config(jestConfig, tsBaseConfig, customConfig, { ignores: ['vitest.config.mts'] });
