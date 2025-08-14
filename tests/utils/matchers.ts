// vitest.setup.ts

import { expect } from 'vitest';

expect.extend({
  // The function is now an anonymous function defined inline
  toHaveCauseCode(received: unknown, expectedCode: string) {
    const { isNot, utils } = this;

    // 1. Ensure the received value is an Error
    if (!(received instanceof Error)) {
      return {
        pass: false,
        message: (): string => `Expected the received value to be an instance of Error, but it was not.`,
      };
    }

    // 2. Check for the 'cause' property
    if (!Object.hasOwn(received, 'cause') || typeof received.cause !== 'object' || received.cause === null) {
      return {
        pass: false,
        message: (): string => `Expected the error to have a 'cause' property of type object.`,
        actual: received,
      };
    }

    // 3. Check for the 'errorCode' property on the cause
    const cause = received.cause as { errorCode?: unknown };
    if (!Object.hasOwn(cause, 'errorCode')) {
      return {
        pass: false,
        message: (): string => `Expected the error's cause to have an 'errorCode' property.`,
      };
    }

    const actualCode = cause.errorCode;
    const pass = actualCode === expectedCode;

    // 4. Return the final result with helpful, color-coded messages
    return {
      pass,
      message: (): string =>
        `Expected error's cause errorCode ${isNot ? 'not ' : ''}to be ${utils.printExpected(expectedCode)}, but it was ${utils.printReceived(actualCode)}.`,
      actual: actualCode,
      expected: expectedCode,
    };
  },
});

// You could add other custom matchers here as well
// anotherMatcher(this: MatcherContext, received: unknown) { /* ... */ }
