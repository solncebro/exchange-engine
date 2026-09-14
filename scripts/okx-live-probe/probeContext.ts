import {
  OKX_BASE_URL,
  OKX_DEMO_BUSINESS_WEBSOCKET_URL,
  OKX_DEMO_PRIVATE_WEBSOCKET_URL,
  OKX_DEMO_PUBLIC_WEBSOCKET_URL,
} from '../../src/constants/okx';
import { OkxHttpClient } from '../../src/http/OkxHttpClient';
import type { OkxInstrumentRaw } from '../../src/normalizers/okxNormalizer';
import type { OkxProbeContext } from './probe.types';
import type { CreateProbeContextArgs, OkxEnvironmentReadResult, ProbeCommandLineSettings } from './probeContext.types';
import { readEnvironmentValue, readTextOption } from '../live-support/liveCommandLine';
import { createLiveLogger } from '../live-support/liveLogger';
import type { LiveLogRecord } from '../live-support/liveLogger.types';
import { armSecretRedactor, printEvidence } from '../live-support/liveOutput';

const DEFAULT_INST_ID = 'BTC-USDT-SWAP';
const CLIENT_ORDER_ID_PREFIX = 'okxprobe';

/**
 * Имена ключей OKX — соглашение ЭТОЙ библиотеки и только оно (образец — `.env.example` рядом с
 * `package.json`); запасных имён соседних проектов у пробы больше нет.
 */
const OKX_CREDENTIAL_NAME_LIST = ['OKX_API_KEY', 'OKX_SECRET', 'OKX_PASSPHRASE'] as const;

export function readOkxEnvironment(): OkxEnvironmentReadResult {
  const [apiKeyName, secretName, passphraseName] = OKX_CREDENTIAL_NAME_LIST;
  const apiKey = readEnvironmentValue(apiKeyName);
  const secret = readEnvironmentValue(secretName);
  const passphrase = readEnvironmentValue(passphraseName);
  const missingNameList: string[] = [];

  if (apiKey === '') {
    missingNameList.push(apiKeyName);
  }

  if (secret === '') {
    missingNameList.push(secretName);
  }

  if (passphrase === '') {
    missingNameList.push(passphraseName);
  }

  return { credentials: { apiKey, secret, passphrase }, missingNameList };
}

export function parseCommandLineSettings(argumentList: string[]): ProbeCommandLineSettings {
  const instId = readTextOption(argumentList, 'inst-id');
  const claimFilter = readTextOption(argumentList, 'only');

  return {
    isOrderAllowed: argumentList.includes('--allow-orders'),
    isVerbose: argumentList.includes('--verbose'),
    instId: instId === '' ? DEFAULT_INST_ID : instId,
    claimFilter,
  };
}

export function createProbeContext(args: CreateProbeContextArgs): OkxProbeContext {
  const { credentials, commandLine } = args;

  armSecretRedactor([credentials.apiKey, credentials.secret, credentials.passphrase]);

  const logRecordList: LiveLogRecord[] = [];
  const logger = createLiveLogger({ isVerbose: commandLine.isVerbose, recordList: logRecordList });
  const httpClient = new OkxHttpClient({
    baseUrl: OKX_BASE_URL,
    apiKey: credentials.apiKey,
    secret: credentials.secret,
    passphrase: credentials.passphrase,
    isDemoMode: true,
    logger,
  });

  let instrument: OkxInstrumentRaw | null = null;
  let clientOrderIdCounter = 0;
  const clientOrderIdPrefix = `${CLIENT_ORDER_ID_PREFIX}${Date.now().toString(36)}`;

  const getInstrument = async (): Promise<OkxInstrumentRaw> => {
    if (instrument !== null) {
      return instrument;
    }

    const rawList = await httpClient.fetchInstruments('SWAP');
    const found = rawList.find((raw) => raw.instId === commandLine.instId);

    if (found === undefined) {
      throw new Error(`OKX не отдала инструмент ${commandLine.instId} в списке бессрочных контрактов`);
    }

    instrument = found;

    return found;
  };

  return {
    credentials,
    settings: {
      isOrderAllowed: commandLine.isOrderAllowed,
      instId: commandLine.instId,
      clientOrderIdPrefix,
      publicWebSocketUrl: OKX_DEMO_PUBLIC_WEBSOCKET_URL,
      businessWebSocketUrl: OKX_DEMO_BUSINESS_WEBSOCKET_URL,
      privateWebSocketUrl: OKX_DEMO_PRIVATE_WEBSOCKET_URL,
    },
    httpClient,
    logger,
    logRecordList,
    cleanupList: [],
    showEvidence: printEvidence,
    getInstrument,
    buildClientOrderId: (): string => {
      clientOrderIdCounter += 1;

      return `${clientOrderIdPrefix}${clientOrderIdCounter}`;
    },
  };
}
