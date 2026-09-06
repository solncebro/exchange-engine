export const BYBIT_BASE_URL = 'https://api.bybit.com';

export const BYBIT_DEMO_BASE_URL = 'https://api-demo.bybit.com';

export const BYBIT_PUBLIC_LINEAR_WEBSOCKET_URL = 'wss://stream.bybit.com/v5/public/linear';
export const BYBIT_PUBLIC_SPOT_WEBSOCKET_URL = 'wss://stream.bybit.com/v5/public/spot';
export const BYBIT_PRIVATE_WEBSOCKET_URL = 'wss://stream.bybit.com/v5/private';
export const BYBIT_TRADE_WEBSOCKET_URL = 'wss://stream.bybit.com/v5/trade';

export const BYBIT_DEMO_PRIVATE_WEBSOCKET_URL = 'wss://stream-demo.bybit.com/v5/private';

export const BYBIT_RECV_WINDOW = 7000;
export const BYBIT_REQUEST_TIMEOUT = 30000;

export const BYBIT_LINEAR_BATCH_CHUNK_SIZE = 20;
export const BYBIT_SPOT_BATCH_CHUNK_SIZE = 10;

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

/**
 * Длительность интервала в миллисекундах. Нужна, чтобы посчитать время закрытия клайна:
 * Bybit его не присылает, но оно однозначно выводится из начала и длительности. Месяц сюда
 * не входит — он не постоянной длины, и высчитывать его так было бы неверно.
 */
export const BYBIT_KLINE_INTERVAL_MS: Record<string, number> = {
  '1m': 60_000,
  '3m': 180_000,
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1h': 3_600_000,
  '2h': 7_200_000,
  '4h': 14_400_000,
  '6h': 21_600_000,
  '12h': 43_200_000,
  '1d': 86_400_000,
  '3d': 259_200_000,
  '1w': 604_800_000,
};

export const BYBIT_TRANSACTION_LOG_MAX_LIMIT = 50;

/**
 * Записи журнала операций, несущие начисление фандинга. У них нулевой денежный поток, а
 * сама сумма лежит в поле `funding` (живой счёт 02.09.2026, FLOCKUSDT: `cashFlow=0`,
 * `funding=-2.3156522`). Один список на клиент и нормализатор — чтобы фильтр и чтение суммы
 * не разошлись.
 */
export const BYBIT_FUNDING_INCOME_TYPE_SET = new Set(['FUNDING', 'SETTLEMENT']);
