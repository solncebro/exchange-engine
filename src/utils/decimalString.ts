import { countDecimalPlaces } from '../precision/precision';
import type { ConvertCoinsToContractsArgs } from './decimalString.types';

const DECIMAL_STRING_PATTERN = /^-?\d+(\.\d+)?$/;

interface DecimalStringComponents {
  isNegative: boolean;
  digitList: string;
  fractionLength: number;
}

interface DecimalMagnitude {
  digits: bigint;
  decimals: number;
}

function tryParseDecimalString(value: string): DecimalStringComponents | null {
  if (!DECIMAL_STRING_PATTERN.test(value)) {
    return null;
  }

  const isNegative = value.startsWith('-');
  const unsignedValue = isNegative ? value.slice(1) : value;
  const [integerPart, fractionPart = ''] = unsignedValue.split('.');

  return { isNegative, digitList: integerPart + fractionPart, fractionLength: fractionPart.length };
}

function parseDecimalString(value: string): DecimalStringComponents {
  const parsed = tryParseDecimalString(value);

  if (parsed === null) {
    throw new Error(`Invalid decimal string: ${value}`);
  }

  return parsed;
}

function normalizeExponentialNotation(value: string): string {
  if (!value.toLowerCase().includes('e')) {
    return value;
  }

  return Number(value).toFixed(countDecimalPlaces(value));
}

function insertDecimalPoint(value: bigint, decimals: number): string {
  const isNegative = value < 0n;
  const digitString = (isNegative ? -value : value).toString();

  if (decimals === 0) {
    return `${isNegative ? '-' : ''}${digitString}`;
  }

  const paddedDigitString = digitString.padStart(decimals + 1, '0');
  const integerPart = paddedDigitString.slice(0, paddedDigitString.length - decimals);
  const fractionPart = paddedDigitString.slice(paddedDigitString.length - decimals);

  return `${isNegative ? '-' : ''}${integerPart}.${fractionPart}`;
}

function trimTrailingZeros(value: string): string {
  if (!value.includes('.')) {
    return value;
  }

  const trimmedValue = value.replace(/0+$/, '').replace(/\.$/, '');

  return trimmedValue === '' || trimmedValue === '-' ? '0' : trimmedValue;
}

function parseRequiredDecimalMagnitude(value: string, label: string): DecimalMagnitude {
  const normalizedValue = normalizeExponentialNotation(value);
  const parsed = tryParseDecimalString(normalizedValue);

  if (parsed === null || parsed.isNegative) {
    throw new Error(`Invalid ${label}: ${value}`);
  }

  return { digits: BigInt(parsed.digitList), decimals: parsed.fractionLength };
}

function parseContractValueMagnitude(contractValue: string): DecimalMagnitude {
  if (contractValue === '') {
    return { digits: 1n, decimals: 0 };
  }

  const magnitude = parseRequiredDecimalMagnitude(contractValue, 'contract value');

  if (magnitude.digits === 0n) {
    throw new Error(`Invalid contract value: ${contractValue}`);
  }

  return magnitude;
}

function parseLotSizeMagnitude(lotSize: string): DecimalMagnitude {
  const magnitude = parseRequiredDecimalMagnitude(lotSize, 'lot size');

  if (magnitude.digits === 0n) {
    throw new Error(`Invalid lot size: ${lotSize}`);
  }

  return magnitude;
}

/**
 * Число в ДЕСЯТИЧНОЙ записи, годной для отправки на биржу. `String(0.0000001)` даёт `"1e-7"` —
 * показательную запись, которую биржа читает не как число, а как мусор (или отвергает запрос
 * целиком). Цена и объём меньше одной миллионной у мелких монет — не экзотика.
 */
export function toDecimalNumberString(value: number): string {
  const valueString = String(value);

  if (!valueString.toLowerCase().includes('e')) {
    return valueString;
  }

  return trimTrailingZeros(value.toFixed(20));
}

export function multiplyDecimalStrings(left: string, right: string): string {
  const parsedLeft = parseDecimalString(normalizeExponentialNotation(left));
  const parsedRight = parseDecimalString(normalizeExponentialNotation(right));

  const product = BigInt(parsedLeft.digitList) * BigInt(parsedRight.digitList);
  const totalFractionLength = parsedLeft.fractionLength + parsedRight.fractionLength;
  const isNegative = parsedLeft.isNegative !== parsedRight.isNegative && product !== 0n;

  return trimTrailingZeros(insertDecimalPoint(isNegative ? -product : product, totalFractionLength));
}

export function convertCoinsToContracts(args: ConvertCoinsToContractsArgs): string {
  const { amount, contractValue, lotSize } = args;

  if (!Number.isFinite(amount) || amount < 0) {
    return '0';
  }

  const amountMagnitude = parseDecimalString(toDecimalNumberString(amount));
  const amountDigits = BigInt(amountMagnitude.digitList);
  const contractValueMagnitude = parseContractValueMagnitude(contractValue);
  const lotSizeMagnitude = parseLotSizeMagnitude(lotSize);

  const numerator = amountDigits * 10n ** BigInt(contractValueMagnitude.decimals + lotSizeMagnitude.decimals);
  const denominator = contractValueMagnitude.digits * lotSizeMagnitude.digits * 10n ** BigInt(amountMagnitude.fractionLength);

  const lotCount = numerator / denominator;

  if (lotCount === 0n) {
    return '0';
  }

  return trimTrailingZeros(insertDecimalPoint(lotCount * lotSizeMagnitude.digits, lotSizeMagnitude.decimals));
}

export function convertContractsToCoins(contracts: string, contractValue: string): number {
  if (contractValue === '') {
    const parsedContracts = parseFloat(contracts);

    return Number.isNaN(parsedContracts) ? 0 : parsedContracts;
  }

  if (contracts === '' || Number.isNaN(parseFloat(contracts))) {
    return 0;
  }

  return parseFloat(multiplyDecimalStrings(contracts, contractValue));
}
