import type { ExchangeLogger } from '../types/common';
import type { OkxSubscriptionArg, OkxWebSocketMessage } from './okxWebSocketUtils.types';

export interface OkxPrivateStreamArgs {
  label: string;
  url: string;
  apiKey: string;
  secret: string;
  passphrase: string;
  logger: ExchangeLogger;
  onNotify?: (message: string) => void | Promise<void>;
  onMessage: (message: OkxWebSocketMessage) => void;
  subscriptionArgList: OkxSubscriptionArg[];
}
