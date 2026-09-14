import type { ExchangeNameEnum } from '../../src/types/common';

export interface ExchangeCredentials {
  apiKey: string;
  secret: string;
  passphrase: string;
}

export interface ExchangeCredentialNames {
  apiKey: string;
  secret: string;
  /** Пустая строка — бирже кодовая фраза не нужна (Binance, Bybit). */
  passphrase: string;
}

export interface CredentialReadResult {
  credentials: ExchangeCredentials;
  missingNameList: string[];
}

export interface CheckCommandLineSettings {
  exchangeNameList: ExchangeNameEnum[];
  isOrderAllowed: boolean;
  isVerbose: boolean;
  titleFilter: string;
  unknownExchangeText: string;
}

export interface CreateCheckContextArgs {
  exchangeName: ExchangeNameEnum;
  credentials: ExchangeCredentials;
  commandLine: CheckCommandLineSettings;
}
