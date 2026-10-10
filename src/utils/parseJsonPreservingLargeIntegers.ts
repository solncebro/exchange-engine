import type { JsonParseWithSource } from './parseJsonPreservingLargeIntegers.types';

const INTEGER_SOURCE_PATTERN = /^-?(?:0|[1-9]\d*)$/;

function parseJsonPreservingLargeIntegers(text: string): unknown {
  const parseWithSource = JSON.parse as JsonParseWithSource;

  return parseWithSource(text, (_key, value, context) => {
    if (typeof value === 'number' && !Number.isSafeInteger(value) && INTEGER_SOURCE_PATTERN.test(context.source)) {
      return context.source;
    }

    return value;
  });
}

export { parseJsonPreservingLargeIntegers };
