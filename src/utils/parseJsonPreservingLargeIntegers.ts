import type { JsonParseWithSource } from './parseJsonPreservingLargeIntegers.types';

const INTEGER_SOURCE_PATTERN = /^-?(?:0|[1-9]\d*)$/;
// The smallest unsafe integer 9007199254740992 has 16 digits, so text without a 16+ digit run cannot contain one.
const LARGE_INTEGER_CANDIDATE_PATTERN = /\d{16,}/;

function parseJsonPreservingLargeIntegers(text: string): unknown {
  if (!LARGE_INTEGER_CANDIDATE_PATTERN.test(text)) {
    return JSON.parse(text);
  }

  const parseWithSource = JSON.parse as JsonParseWithSource;

  return parseWithSource(text, (_key, value, context) => {
    if (typeof value === 'number' && !Number.isSafeInteger(value) && INTEGER_SOURCE_PATTERN.test(context.source)) {
      return context.source;
    }

    return value;
  });
}

export { parseJsonPreservingLargeIntegers };
