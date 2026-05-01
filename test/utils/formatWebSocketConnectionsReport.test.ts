import { formatWebSocketConnectionsReport } from '../../src/utils/formatWebSocketConnectionsReport';
import type { WebSocketConnectionInfo } from '../../src/types/common';
import { WebSocketConnectionTypeEnum } from '../../src/types/common';

const buildConnectionInfo = (
  override: Partial<WebSocketConnectionInfo> = {},
): WebSocketConnectionInfo => ({
  label: 'Binance Futures Public WebSocket symbols-001',
  url: 'wss://fstream.binance.com/stream?streams=btcusdt_perpetual@continuousKline_1m',
  isConnected: true,
  type: WebSocketConnectionTypeEnum.Public,
  subscriptionList: [
    'Klines BTCUSDT 1m',
    'Klines BTCUSDT 5m',
    'Klines ETHUSDT 1m',
    'Klines ETHUSDT 5m',
  ],
  messageCount: 1234,
  lastMessageTimestamp: 1700000000000,
  ...override,
});

describe('formatWebSocketConnectionsReport', () => {
  it('renders header with total and extracted source prefix', () => {
    const report = formatWebSocketConnectionsReport({
      connectionInfoList: [
        buildConnectionInfo({ label: 'Binance Futures Public WebSocket symbols-001' }),
        buildConnectionInfo({ label: 'Binance Futures Public WebSocket symbols-002' }),
      ],
      nowTimestamp: 1700000000000,
    });

    expect(report).toContain('total: 2 | source: Binance Futures Public WebSocket');
  });

  it('omits source prefix when labels do not share one', () => {
    const report = formatWebSocketConnectionsReport({
      connectionInfoList: [
        buildConnectionInfo({ label: 'Alpha' }),
        buildConnectionInfo({ label: 'Beta' }),
      ],
      nowTimestamp: 1700000000000,
    });

    expect(report).toContain('total: 2');
    expect(report).not.toContain('source:');
  });

  it('lists deduplicated symbols with stream type prefix', () => {
    const report = formatWebSocketConnectionsReport({
      connectionInfoList: [buildConnectionInfo()],
      nowTimestamp: 1700000000000,
    });

    expect(report).toContain('   Klines: BTCUSDT, ETHUSDT');
  });

  it('renders plain topics without prefix', () => {
    const report = formatWebSocketConnectionsReport({
      connectionInfoList: [
        buildConnectionInfo({
          label: 'Binance Futures Public WebSocket tickers-markprices',
          subscriptionList: ['Tickers', 'MarkPrices'],
        }),
      ],
      nowTimestamp: 1700000000000,
    });

    expect(report).toContain('   Tickers, MarkPrices');
    expect(report).not.toContain('Tickers:');
    expect(report).not.toContain('MarkPrices:');
  });

  it('summarizes symbol count when list exceeds maxSymbolListSize', () => {
    const manySymbols: string[] = [];

    for (let i = 0; i < 532; i++) {
      manySymbols.push(`Klines SYMBOL${i}USDT 1m`);
    }

    const report = formatWebSocketConnectionsReport({
      connectionInfoList: [
        buildConnectionInfo({ subscriptionList: manySymbols }),
      ],
      nowTimestamp: 1700000000000,
    });

    expect(report).toContain('   Klines: 532 symbols');
    expect(report).not.toContain('SYMBOL0USDT, SYMBOL1USDT');
  });

  it('respects custom maxSymbolListSize override', () => {
    const fiveSymbols: string[] = [
      'Klines AUSDT 1m',
      'Klines BUSDT 1m',
      'Klines CUSDT 1m',
      'Klines DUSDT 1m',
      'Klines EUSDT 1m',
    ];

    const reportSummary = formatWebSocketConnectionsReport({
      connectionInfoList: [buildConnectionInfo({ subscriptionList: fiveSymbols })],
      nowTimestamp: 1700000000000,
      maxSymbolListSize: 3,
    });

    expect(reportSummary).toContain('   Klines: 5 symbols');

    const reportList = formatWebSocketConnectionsReport({
      connectionInfoList: [buildConnectionInfo({ subscriptionList: fiveSymbols })],
      nowTimestamp: 1700000000000,
      maxSymbolListSize: 10,
    });

    expect(reportList).toContain('   Klines: AUSDT, BUSDT, CUSDT, DUSDT, EUSDT');
  });

  it('groups multiple stream types separately when mixed', () => {
    const report = formatWebSocketConnectionsReport({
      connectionInfoList: [
        buildConnectionInfo({
          subscriptionList: [
            'Klines BTCUSDT 1m',
            'Klines ETHUSDT 1m',
            'Trades SOLUSDT',
            'Tickers',
            'MarkPrices',
          ],
        }),
      ],
      nowTimestamp: 1700000000000,
    });

    expect(report).toContain('   Klines: BTCUSDT, ETHUSDT');
    expect(report).toContain('   Trades: SOLUSDT');
    expect(report).toContain('   Tickers, MarkPrices');
  });

  it('shows "never" when lastMessageTimestamp is missing', () => {
    const report = formatWebSocketConnectionsReport({
      connectionInfoList: [
        buildConnectionInfo({ messageCount: 0, lastMessageTimestamp: undefined }),
      ],
      nowTimestamp: 1700000000000,
    });

    expect(report).toContain('| 0 msgs | never');
  });

  it('shows seconds-ago for recent message', () => {
    const report = formatWebSocketConnectionsReport({
      connectionInfoList: [
        buildConnectionInfo({ lastMessageTimestamp: 1700000000000 - 5000 }),
      ],
      nowTimestamp: 1700000000000,
    });

    expect(report).toContain('| 5s ago');
  });

  it('shows "❌" for disconnected connections', () => {
    const report = formatWebSocketConnectionsReport({
      connectionInfoList: [buildConnectionInfo({ isConnected: false })],
      nowTimestamp: 1700000000000,
    });

    expect(report).toContain('❌');
  });

  it('uses custom formatTimestamp when provided', () => {
    const report = formatWebSocketConnectionsReport({
      connectionInfoList: [],
      nowTimestamp: 1700000000000,
      formatTimestamp: () => 'CUSTOM-TIME',
    });

    expect(report).toContain('now: CUSTOM-TIME');
  });

  it('uses custom headerLine when provided', () => {
    const report = formatWebSocketConnectionsReport({
      connectionInfoList: [],
      nowTimestamp: 1700000000000,
      headerLine: '*Custom Header*',
    });

    expect(report.startsWith('*Custom Header*\n')).toBe(true);
  });

  it('handles empty connection list gracefully', () => {
    const report = formatWebSocketConnectionsReport({
      connectionInfoList: [],
      nowTimestamp: 1700000000000,
    });

    expect(report).toContain('total: 0');
  });
});
