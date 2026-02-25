export const BYBIT_BASE_URL = 'https://api.bybit.com';
export const BYBIT_TESTNET_BASE_URL = 'https://api-testnet.bybit.com';

export const BYBIT_PUBLIC_LINEAR_WS_URL = 'wss://stream.bybit.com/v5/public/linear';
export const BYBIT_PUBLIC_SPOT_WS_URL = 'wss://stream.bybit.com/v5/public/spot';
export const BYBIT_PRIVATE_WS_URL = 'wss://stream.bybit.com/v5/private';
export const BYBIT_TRADE_WS_URL = 'wss://stream.bybit.com/v5/trade';

export const BYBIT_PUBLIC_LINEAR_WS_TESTNET_URL = 'wss://stream-testnet.bybit.com/v5/public/linear';
export const BYBIT_PUBLIC_SPOT_WS_TESTNET_URL = 'wss://stream-testnet.bybit.com/v5/public/spot';
export const BYBIT_PRIVATE_WS_TESTNET_URL = 'wss://stream-testnet.bybit.com/v5/private';
export const BYBIT_TRADE_WS_TESTNET_URL = 'wss://stream-testnet.bybit.com/v5/trade';

export const BYBIT_RECV_WINDOW = 7000; // milliseconds
export const BYBIT_REQUEST_TIMEOUT = 30000; // 30 seconds

// Маппинг KlineInterval -> формат Bybit (числа минут или D/W/M)
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
