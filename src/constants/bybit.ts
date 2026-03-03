export const BYBIT_BASE_URL = 'https://api.bybit.com';

export const BYBIT_DEMO_BASE_URL = 'https://api-demo.bybit.com';

export const BYBIT_PUBLIC_LINEAR_WEBSOCKET_URL = 'wss://stream.bybit.com/v5/public/linear';
export const BYBIT_PUBLIC_SPOT_WEBSOCKET_URL = 'wss://stream.bybit.com/v5/public/spot';
export const BYBIT_PRIVATE_WEBSOCKET_URL = 'wss://stream.bybit.com/v5/private';
export const BYBIT_TRADE_WEBSOCKET_URL = 'wss://stream.bybit.com/v5/trade';

export const BYBIT_DEMO_PUBLIC_LINEAR_WEBSOCKET_URL = 'wss://stream-demo.bybit.com/v5/public/linear';
export const BYBIT_DEMO_PUBLIC_SPOT_WEBSOCKET_URL = 'wss://stream-demo.bybit.com/v5/public/spot';

export const BYBIT_RECV_WINDOW = 7000;
export const BYBIT_REQUEST_TIMEOUT = 30000;

export const BYBIT_KLINE_INTERVAL: Record<string, string> = {
  '1m': '1',
  '3m': '3',
  '5m': '5',
  '15m': '15',
  '30m': '30',
  '1h': '60',
  '2h': '120',
  '4h': '240',
  '6h': '360',
  '12h': '720',
  '1d': 'D',
  '3d': '3D',
  '1w': 'W',
  '1M': 'M',
};
