export const BINANCE_SPOT_BASE_URL = 'https://api.binance.com';
export const BINANCE_FUTURES_BASE_URL = 'https://fapi.binance.com';

export const BINANCE_DEMO_SPOT_BASE_URL = 'https://demo-api.binance.com';
export const BINANCE_DEMO_FUTURES_BASE_URL = 'https://demo-fapi.binance.com';

export const BINANCE_FUTURES_WS_STREAM_URL = 'wss://fstream.binance.com/ws';
export const BINANCE_FUTURES_WS_COMBINED_URL = 'wss://fstream.binance.com/stream';
export const BINANCE_SPOT_WS_STREAM_URL = 'wss://stream.binance.com:9443/ws';

export const BINANCE_DEMO_FUTURES_WS_COMBINED_URL = 'wss://fstream.binancefuture.com/stream';

export const BINANCE_REQUEST_TIMEOUT = 30000;

export const BINANCE_KLINE_LIMIT_SPOT = 1000;
export const BINANCE_KLINE_LIMIT_FUTURES = 499;

export const BINANCE_KLINE_INTERVAL: Record<string, string> = {
  '1m': '1m',
  '3m': '3m',
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '1h': '1h',
  '2h': '2h',
  '4h': '4h',
  '6h': '6h',
  '12h': '12h',
  '1d': '1d',
  '3d': '3d',
  '1w': '1w',
  '1M': '1M',
};
