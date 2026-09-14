import { OkxSymbolMap } from '../../src/exchanges/okxSymbol';

/** Числовые коды инструментов — в том виде, в каком OKX отдаёт их в `/api/v5/public/instruments`. */
export const OKX_BTC_SWAP_INST_ID_CODE = 2021032622053443;
export const OKX_ETH_SWAP_INST_ID_CODE = 2021032622053444;

/** Загруженная карта имён с двумя бессрочными инструментами, которыми пользуются тесты канала. */
export function createOkxSwapSymbolMap(): OkxSymbolMap {
  const symbolMap = new OkxSymbolMap({ isSwap: true });

  symbolMap.register(
    { symbol: 'BTCUSDT', instId: 'BTC-USDT-SWAP', baseAsset: 'BTC', quoteAsset: 'USDT', isSwap: true },
    OKX_BTC_SWAP_INST_ID_CODE,
  );
  symbolMap.register(
    { symbol: 'ETHUSDT', instId: 'ETH-USDT-SWAP', baseAsset: 'ETH', quoteAsset: 'USDT', isSwap: true },
    OKX_ETH_SWAP_INST_ID_CODE,
  );

  return symbolMap;
}
