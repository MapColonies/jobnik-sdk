import { hostname } from 'node:os';
import { Span, SpanOptions, SpanStatusCode, trace, context, SpanContext, propagation } from '@opentelemetry/api';
import { readPackageJsonSync } from '@map-colonies/read-pkg';
import { ATTR_MESSAGING_CLIENT_ID, ATTR_MESSAGING_SYSTEM } from './semconv';

// Dynamically set from package.json
const packageJson = readPackageJsonSync();
const SDK_INSTRUMENTATION_SCOPE = packageJson.name ?? 'unknown-sdk';
const SDK_VERSION = packageJson.version ?? 'unknown-version';

// const VERSION = '00';
// const RADIX = 16;
// const NUMBER_OF_TRACE_PARENT_PARTS = 4; // version, traceId, parentId, flags
// const VERSION_PART = '(?!ff)[\\da-f]{2}';
// const TRACE_ID_PART = '(?![0]{32})[\\da-f]{32}';
// const PARENT_ID_PART = '(?![0]{16})[\\da-f]{16}';
// const FLAGS_PART = '[\\da-f]{2}';
// const TRACE_PARENT_REGEX = new RegExp(`^\\s?(${VERSION_PART})-(${TRACE_ID_PART})-(${PARENT_ID_PART})-(${FLAGS_PART})(-.*)?\\s?$`);

// interface W3CTraceContext {
//   traceparent: string;
//   tracestate?: string;
// }

export const BASE_ATTRIBUTES = {
  [ATTR_MESSAGING_SYSTEM]: 'jobnik',
  [ATTR_MESSAGING_CLIENT_ID]: hostname(),
};

export function getSpanContext(carrier: unknown): SpanContext | undefined {
  const remoteContext = propagation.extract(context.active(), carrier);
  return trace.getSpanContext(remoteContext);
}

export async function withSpan<T>(spanName: string, spanOptions: SpanOptions, fn: (span: Span) => Promise<T>): Promise<T> {
  if (spanOptions.attributes) {
    spanOptions.attributes = { ...BASE_ATTRIBUTES, ...spanOptions.attributes };
  } else {
    spanOptions.attributes = structuredClone(BASE_ATTRIBUTES);
  }
  return tracer.startActiveSpan(spanName, spanOptions, async (span) => {
    try {
      const result = await fn(span);
      handleSpanOnSuccess(span);
      return result;
    } catch (error) {
      handleSpanOnError(span, error);
      throw error;
    }
  });
}

/**
 * Ends the given span with status OK
 * @param span span to be ended
 * @group Tracing Utilities
 */
export const handleSpanOnSuccess = (span: Span | undefined): void => {
  if (!span) {
    return;
  }

  span.setStatus({ code: SpanStatusCode.OK });
  span.end();
};

/**
 * Ends the given span with status ERROR and records the error
 * @param span span to be ended
 * @param error error to be recorded
 * @group Tracing Utilities
 */
export const handleSpanOnError = (span: Span | undefined, error?: unknown): void => {
  if (!span) {
    return;
  }

  span.setStatus({ code: SpanStatusCode.ERROR });

  if (error instanceof Error) {
    span.recordException(error);
  }

  span.end();
};

// export function getW3CTraceContext(spanContext: SpanContext): W3CTraceContext {
//   const traceParent = `${VERSION}-${spanContext.traceId}-${spanContext.spanId}-0${Number(spanContext.traceFlags || TraceFlags.NONE).toString(RADIX)}`;
//   const traceState = spanContext.traceState?.serialize();
//   return { traceparent: traceParent, tracestate: traceState };
// }

// export function parseTraceParent(traceParent: string): SpanContext | null {
//   const match = TRACE_PARENT_REGEX.exec(traceParent);
//   if (!match) {
//     return null;
//   }

//   // According to the specification the implementation should be compatible
//   // with future versions. If there are more parts, we only reject it if it's using version 00
//   if (match[1] === '00' && match[5] !== undefined) {
//     return null;
//   }

//   if (match.length > NUMBER_OF_TRACE_PARENT_PARTS) {
//     throw new Error(`Invalid traceparent format: ${traceParent}`);
//   }

//   return {
//     traceId: match[2] as string,
//     spanId: match[3] as string,
//     traceFlags: parseInt(match[4] as string, 16),
//   };
// }

/**
 * @remarks
 * The tracer instance for the SDK.
 * It is initialized from the global TracerProvider using the OTel API.
 * The SDK relies on the application's global OTel setup.
 *
 * @see {@link https://opentelemetry.io/docs/instrumentation/js/instrumentation/#get-a-tracer}
 */
export const tracer = trace.getTracer(SDK_INSTRUMENTATION_SCOPE, SDK_VERSION);
