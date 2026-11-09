import type { ExchangeNameEnum, Order, OrderExecutionSummary } from '../../src/types/common';
import type { ExchangeClient } from '../../src/types/exchange';

export interface ReadExecutionSummaryArgs {
  client: ExchangeClient;
  symbol: string;
  orderId: string;
  startTime: number;
  amount: number;
}

export interface VerifyExecutionSummaryArgs {
  label: string;
  order: Order;
  summary: OrderExecutionSummary;
  amount: number;
  referencePrice: number;
  startTime: number;
}

export interface DescribeAccountTradesArgs {
  exchangeName: ExchangeNameEnum;
  client: ExchangeClient;
  symbol: string;
  startTime: number;
  executionIdList: string[];
}

export interface AccountTradesReport {
  text: string;
  violationList: string[];
}
