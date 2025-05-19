import * as opentelemetry from '@opentelemetry/api';
import { readPackageJsonSync } from '@map-colonies/read-pkg';

// Dynamically set from package.json
const packageJson = readPackageJsonSync();
const SDK_INSTRUMENTATION_SCOPE = packageJson.name ?? 'unknown-sdk';
const SDK_VERSION = packageJson.version ?? 'unknown-version';

/**
 * @remarks
 * The tracer instance for the SDK.
 * It is initialized from the global TracerProvider using the OTel API.
 * The SDK relies on the application's global OTel setup.
 *
 * @see {@link https://opentelemetry.io/docs/instrumentation/js/instrumentation/#get-a-tracer}
 */
export const tracer = opentelemetry.trace.getTracer(SDK_INSTRUMENTATION_SCOPE, SDK_VERSION);
