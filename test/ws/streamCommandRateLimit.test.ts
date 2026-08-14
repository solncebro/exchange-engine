import {
  BINANCE_WS_COMMAND_LIMIT_PER_SECOND,
  BINANCE_WS_QUEUE_RATE_PER_SECOND,
  BINANCE_WS_SOCKET_CAP_PER_SECOND,
} from '../../src/ws/streamCommandRateLimit';

describe('streamCommandRateLimit', () => {
  it('keeps the queue rate below the socket cap and the socket cap below the exchange command limit, so a future edit cannot quietly raise the budget above what Binance allows', () => {
    expect(BINANCE_WS_QUEUE_RATE_PER_SECOND).toBeLessThan(BINANCE_WS_SOCKET_CAP_PER_SECOND);
    expect(BINANCE_WS_SOCKET_CAP_PER_SECOND).toBeLessThan(BINANCE_WS_COMMAND_LIMIT_PER_SECOND);
  });
});
