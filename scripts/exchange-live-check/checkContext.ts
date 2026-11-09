import { BINANCE_DEMO_FUTURES_BASE_URL } from '../../src/constants/binance';
import { BYBIT_DEMO_BASE_URL } from '../../src/constants/bybit';
import { Exchange } from '../../src/exchanges/Exchange';
import { BinanceFuturesHttpClient } from '../../src/http/BinanceFuturesHttpClient';
import { BybitHttpClient } from '../../src/http/BybitHttpClient';
import type { ExchangeConfig, TickerBySymbol, TradeSymbolBySymbol } from '../../src/types/common';
import { ExchangeNameEnum } from '../../src/types/common';
import type { ExchangeClient } from '../../src/types/exchange';
import { readEnvironmentValue, readTextOption } from '../live-support/liveCommandLine';
import { createLiveLogger } from '../live-support/liveLogger';
import { OwnPositionLedger } from '../live-support/liveOrder';
import type { LiveLogRecord } from '../live-support/liveLogger.types';
import { armSecretRedactor, printEvidence } from '../live-support/liveOutput';
import type {
  CheckCommandLineSettings,
  CreateCheckContextArgs,
  CredentialReadResult,
  ExchangeCredentialNames,
} from './checkContext.types';
import type { LiveCheckContext } from './liveCheck.types';

const FUTURES_SYMBOL = 'BTCUSDT';
const SPOT_SYMBOL = 'BTCUSDT';
const EXECUTION_SYMBOL = 'ETHUSDT';
const CLIENT_ORDER_ID_PREFIX = 'elc';

export const EXCHANGE_NAME_LIST: ExchangeNameEnum[] = [
  ExchangeNameEnum.Binance,
  ExchangeNameEnum.Bybit,
  ExchangeNameEnum.Okx,
];

/**
 * Имена переменных — соглашение ЭТОЙ библиотеки и только оно; образец лежит в `.env.example` рядом
 * с `package.json`. Запасных имён соседних проектов здесь нет: ключи живут в собственном `.env`.
 * Пустая строка в `passphrase` означает, что бирже кодовая фраза не нужна.
 */
const CREDENTIAL_NAMES_BY_EXCHANGE: Record<ExchangeNameEnum, ExchangeCredentialNames> = {
  [ExchangeNameEnum.Binance]: {
    apiKey: 'BINANCE_API_KEY',
    secret: 'BINANCE_SECRET',
    passphrase: '',
  },
  [ExchangeNameEnum.Bybit]: {
    apiKey: 'BYBIT_API_KEY',
    secret: 'BYBIT_SECRET',
    passphrase: '',
  },
  [ExchangeNameEnum.Okx]: {
    apiKey: 'OKX_API_KEY',
    secret: 'OKX_SECRET',
    passphrase: 'OKX_PASSPHRASE',
  },
};

const ORDER_BOOK_DEPTH_BY_EXCHANGE: Record<ExchangeNameEnum, number> = {
  [ExchangeNameEnum.Binance]: 20,
  [ExchangeNameEnum.Bybit]: 50,
  [ExchangeNameEnum.Okx]: 50,
};

function parseExchangeNameList(optionText: string): ExchangeNameEnum[] {
  if (optionText === '') {
    return EXCHANGE_NAME_LIST;
  }

  const requestedList = optionText.split(',').map((entry) => entry.trim().toLowerCase());

  return EXCHANGE_NAME_LIST.filter((exchangeName) => requestedList.includes(exchangeName));
}

function buildUnknownExchangeText(optionText: string): string {
  if (optionText === '') {
    return '';
  }

  const knownList: string[] = EXCHANGE_NAME_LIST;
  const unknownList = optionText
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== '' && !knownList.includes(entry));

  return unknownList.join(', ');
}

export function parseCheckCommandLine(argumentList: string[]): CheckCommandLineSettings {
  const exchangeOptionText = readTextOption(argumentList, 'exchange');

  return {
    exchangeNameList: parseExchangeNameList(exchangeOptionText),
    isOrderAllowed: argumentList.includes('--allow-orders'),
    isVerbose: argumentList.includes('--verbose'),
    titleFilter: readTextOption(argumentList, 'only'),
    unknownExchangeText: buildUnknownExchangeText(exchangeOptionText),
  };
}

export function readExchangeCredentials(exchangeName: ExchangeNameEnum): CredentialReadResult {
  const names = CREDENTIAL_NAMES_BY_EXCHANGE[exchangeName];
  const apiKey = readEnvironmentValue(names.apiKey);
  const secret = readEnvironmentValue(names.secret);
  const passphrase = readEnvironmentValue(names.passphrase);
  const missingNameList: string[] = [];

  if (apiKey === '') {
    missingNameList.push(names.apiKey);
  }

  if (secret === '') {
    missingNameList.push(names.secret);
  }

  if (names.passphrase !== '' && passphrase === '') {
    missingNameList.push(names.passphrase);
  }

  return { credentials: { apiKey, secret, passphrase }, missingNameList };
}

export function createCheckContext(args: CreateCheckContextArgs): LiveCheckContext {
  const { exchangeName, credentials, commandLine } = args;

  armSecretRedactor([credentials.apiKey, credentials.secret, credentials.passphrase]);

  const logRecordList: LiveLogRecord[] = [];
  const logger = createLiveLogger({ isVerbose: commandLine.isVerbose, recordList: logRecordList });
  const config: ExchangeConfig = {
    apiKey: credentials.apiKey,
    secret: credentials.secret,
    passphrase: credentials.passphrase,
    isDemoMode: true,
  };
  const createStreamExchange = (): Exchange => new Exchange(exchangeName, { config, logger });
  const exchange = createStreamExchange();
  const clientOrderIdPrefix = `${CLIENT_ORDER_ID_PREFIX}${Date.now().toString(36)}`;

  const tradeSymbolLoadByClient = new Map<ExchangeClient, Promise<TradeSymbolBySymbol>>();

  let tickerBySymbol: TickerBySymbol | null = null;
  let clientOrderIdCounter = 0;

  const readFuturesTickers = async (): Promise<TickerBySymbol> => {
    if (tickerBySymbol !== null) {
      return tickerBySymbol;
    }

    tickerBySymbol = await exchange.futures.fetchTickers();

    return tickerBySymbol;
  };

  const readTradeSymbols = async (client: ExchangeClient): Promise<TradeSymbolBySymbol> => {
    if (client.tradeSymbols.size > 0) {
      return client.tradeSymbols;
    }

    const pendingLoad = tradeSymbolLoadByClient.get(client) ?? client.loadTradeSymbols();

    tradeSymbolLoadByClient.set(client, pendingLoad);

    try {
      return await pendingLoad;
    } finally {
      tradeSymbolLoadByClient.delete(client);
    }
  };

  return {
    exchangeName,
    exchange,
    settings: {
      futuresSymbol: FUTURES_SYMBOL,
      spotSymbol: SPOT_SYMBOL,
      executionSymbol: EXECUTION_SYMBOL,
      orderBookDepth: ORDER_BOOK_DEPTH_BY_EXCHANGE[exchangeName],
      isOrderAllowed: commandLine.isOrderAllowed,
      clientOrderIdPrefix,
    },
    logger,
    showEvidence: printEvidence,
    readFuturesTickers,
    readTradeSymbols,
    createStreamExchange,
    bybitDemoHttpClient: exchangeName === ExchangeNameEnum.Bybit
      ? new BybitHttpClient({ baseUrl: BYBIT_DEMO_BASE_URL, apiKey: credentials.apiKey, secret: credentials.secret, logger })
      : null,
    binanceDemoHttpClient: exchangeName === ExchangeNameEnum.Binance
      ? new BinanceFuturesHttpClient({ baseUrl: BINANCE_DEMO_FUTURES_BASE_URL, apiKey: credentials.apiKey, secret: credentials.secret, logger })
      : null,
    ownPositionLedger: new OwnPositionLedger(EXECUTION_SYMBOL),
    buildClientOrderId: (): string => {
      clientOrderIdCounter += 1;

      return `${clientOrderIdPrefix}${clientOrderIdCounter}`;
    },
  };
}
