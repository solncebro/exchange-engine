import { parseOkxInstId, buildOkxInstIdFallback, OkxSymbolMap } from '../../src/exchanges/okxSymbol';
import { ExchangeError } from '../../src/errors/ExchangeError';

describe('parseOkxInstId', () => {
  it('parses a swap instrument id', () => {
    expect(parseOkxInstId('BTC-USDT-SWAP')).toEqual({
      symbol: 'BTCUSDT',
      instId: 'BTC-USDT-SWAP',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      isSwap: true,
    });
  });

  it('parses a spot instrument id', () => {
    expect(parseOkxInstId('BTC-USDT')).toEqual({
      symbol: 'BTCUSDT',
      instId: 'BTC-USDT',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      isSwap: false,
    });
  });

  it('parses a non-USDT swap instrument id', () => {
    expect(parseOkxInstId('BTC-USD-SWAP')).toEqual({
      symbol: 'BTCUSD',
      instId: 'BTC-USD-SWAP',
      baseAsset: 'BTC',
      quoteAsset: 'USD',
      isSwap: true,
    });
  });

  it('returns null for a dated future', () => {
    expect(parseOkxInstId('BTC-USD-240628')).toBeNull();
  });

  it('returns null for an option', () => {
    expect(parseOkxInstId('BTC-USD-240628-50000-C')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(parseOkxInstId('')).toBeNull();
  });

  it('returns null for a symbol without a dash', () => {
    expect(parseOkxInstId('BTCUSDT')).toBeNull();
  });

  it('returns null for a dangling dash', () => {
    expect(parseOkxInstId('BTC-')).toBeNull();
  });
});

describe('buildOkxInstIdFallback', () => {
  it('builds a swap instId from a symbol', () => {
    expect(buildOkxInstIdFallback({ symbol: 'BTCUSDT', isSwap: true })).toBe('BTC-USDT-SWAP');
  });

  it('builds a spot instId from a symbol', () => {
    expect(buildOkxInstIdFallback({ symbol: 'ETHUSDC', isSwap: false })).toBe('ETH-USDC');
  });

  it('returns null when no known quote currency matches', () => {
    expect(buildOkxInstIdFallback({ symbol: 'BTCUSD', isSwap: true })).toBeNull();
  });

  it('returns null when the base asset would be empty', () => {
    expect(buildOkxInstIdFallback({ symbol: 'USDT', isSwap: true })).toBeNull();
  });
});

describe('OkxSymbolMap', () => {
  it('resolves a registered symbol to its instId and back', () => {
    const symbolMap = new OkxSymbolMap({ isSwap: true });
    symbolMap.register({ symbol: '1INCHUSDT', instId: '1INCH-USDT-SWAP', baseAsset: '1INCH', quoteAsset: 'USDT', isSwap: true });

    expect(symbolMap.resolveInstId('1INCHUSDT')).toBe('1INCH-USDT-SWAP');
    expect(symbolMap.resolveSymbol('1INCH-USDT-SWAP')).toBe('1INCHUSDT');
    expect(symbolMap.has('1INCHUSDT')).toBe(true);
  });

  it('falls back to the naming rule for an unregistered symbol', () => {
    const symbolMap = new OkxSymbolMap({ isSwap: true });

    expect(symbolMap.resolveInstId('SOLUSDT')).toBe('SOL-USDT-SWAP');
  });

  it('throws ExchangeError when resolveInstId cannot resolve a symbol', () => {
    const symbolMap = new OkxSymbolMap({ isSwap: true });

    expect(() => symbolMap.resolveInstId('BTCUSD')).toThrow(ExchangeError);

    try {
      symbolMap.resolveInstId('BTCUSD');
    } catch (error) {
      expect(error).toBeInstanceOf(ExchangeError);
      expect((error as ExchangeError).code).toBe('OKX_SYMBOL_UNRESOLVED');
      expect((error as ExchangeError).exchange).toBe('OKX');
    }
  });

  it('throws ExchangeError when resolveSymbol cannot resolve an instId', () => {
    const symbolMap = new OkxSymbolMap({ isSwap: true });

    expect(() => symbolMap.resolveSymbol('BTC-USD-240628')).toThrow(ExchangeError);
  });

  it('throws ExchangeError when a spot map resolves a swap instId', () => {
    const symbolMap = new OkxSymbolMap({ isSwap: false });

    expect(() => symbolMap.resolveSymbol('BTC-USDT-SWAP')).toThrow(ExchangeError);
  });

  it('throws ExchangeError when a swap map resolves a spot instId', () => {
    const symbolMap = new OkxSymbolMap({ isSwap: true });

    expect(() => symbolMap.resolveSymbol('BTC-USDT')).toThrow(ExchangeError);
  });

  it('resolves the numeric instrument code registered for a symbol', () => {
    const symbolMap = new OkxSymbolMap({ isSwap: true });
    symbolMap.register(
      { symbol: 'BTCUSDT', instId: 'BTC-USDT-SWAP', baseAsset: 'BTC', quoteAsset: 'USDT', isSwap: true },
      2021032622053443,
    );

    expect(symbolMap.resolveInstIdCode('BTCUSDT')).toBe(2021032622053443);
  });

  it('throws OKX_INSTRUMENTS_NOT_LOADED when no instrument code is loaded at all', () => {
    const symbolMap = new OkxSymbolMap({ isSwap: true });

    expect(() => symbolMap.resolveInstIdCode('BTCUSDT')).toThrow(ExchangeError);

    try {
      symbolMap.resolveInstIdCode('BTCUSDT');
    } catch (error) {
      expect((error as ExchangeError).code).toBe('OKX_INSTRUMENTS_NOT_LOADED');
    }
  });

  it('throws OKX_SYMBOL_UNRESOLVED for a symbol missing from a loaded code map', () => {
    const symbolMap = new OkxSymbolMap({ isSwap: true });
    symbolMap.register(
      { symbol: 'BTCUSDT', instId: 'BTC-USDT-SWAP', baseAsset: 'BTC', quoteAsset: 'USDT', isSwap: true },
      2021032622053443,
    );

    try {
      symbolMap.resolveInstIdCode('ETHUSDT');
    } catch (error) {
      expect((error as ExchangeError).code).toBe('OKX_SYMBOL_UNRESOLVED');
    }
  });

  it('never guesses a code: an instrument registered without one is refused, not approximated', () => {
    const symbolMap = new OkxSymbolMap({ isSwap: true });
    symbolMap.register({ symbol: 'ETHUSDT', instId: 'ETH-USDT-SWAP', baseAsset: 'ETH', quoteAsset: 'USDT', isSwap: true });
    symbolMap.register(
      { symbol: 'BTCUSDT', instId: 'BTC-USDT-SWAP', baseAsset: 'BTC', quoteAsset: 'USDT', isSwap: true },
      2021032622053443,
    );

    expect(symbolMap.resolveInstId('ETHUSDT')).toBe('ETH-USDT-SWAP');
    expect(() => symbolMap.resolveInstIdCode('ETHUSDT')).toThrow(ExchangeError);
  });

  it('drops the previous code when the instrument is registered again without one', () => {
    const symbolMap = new OkxSymbolMap({ isSwap: true });
    const identity = { symbol: 'BTCUSDT', instId: 'BTC-USDT-SWAP', baseAsset: 'BTC', quoteAsset: 'USDT', isSwap: true };
    symbolMap.register(identity, 2021032622053443);

    symbolMap.register(identity);

    expect(() => symbolMap.resolveInstIdCode('BTCUSDT')).toThrow(ExchangeError);
  });

  it('ignores a code that is not a positive integer', () => {
    const symbolMap = new OkxSymbolMap({ isSwap: true });
    const identity = { symbol: 'BTCUSDT', instId: 'BTC-USDT-SWAP', baseAsset: 'BTC', quoteAsset: 'USDT', isSwap: true };

    symbolMap.register(identity, 0);
    expect(() => symbolMap.resolveInstIdCode('BTCUSDT')).toThrow(ExchangeError);

    symbolMap.register(identity, null);
    expect(() => symbolMap.resolveInstIdCode('BTCUSDT')).toThrow(ExchangeError);
  });

  it('clears the instrument codes together with the names', () => {
    const symbolMap = new OkxSymbolMap({ isSwap: true });
    symbolMap.register(
      { symbol: 'BTCUSDT', instId: 'BTC-USDT-SWAP', baseAsset: 'BTC', quoteAsset: 'USDT', isSwap: true },
      2021032622053443,
    );

    symbolMap.clear();

    expect(() => symbolMap.resolveInstIdCode('BTCUSDT')).toThrow(ExchangeError);
  });

  it('clears registered entries', () => {
    const symbolMap = new OkxSymbolMap({ isSwap: true });
    symbolMap.register({ symbol: 'BTCUSDT', instId: 'BTC-USDT-SWAP', baseAsset: 'BTC', quoteAsset: 'USDT', isSwap: true });

    symbolMap.clear();

    expect(symbolMap.has('BTCUSDT')).toBe(false);
    expect(symbolMap.size()).toBe(0);
  });

  it('overwrites the registration when the same symbol is registered again', () => {
    const symbolMap = new OkxSymbolMap({ isSwap: true });
    symbolMap.register({ symbol: 'BTCUSDT', instId: 'BTC-USDT-SWAP', baseAsset: 'BTC', quoteAsset: 'USDT', isSwap: true });
    symbolMap.register({ symbol: 'BTCUSDT', instId: 'BTC-USDT-SWAP', baseAsset: 'BTC', quoteAsset: 'USDT', isSwap: true });

    expect(symbolMap.size()).toBe(1);
  });
});

describe('OkxSymbolMap collisions', () => {
  it('reports a collision when a second instrument claims a common name that is already taken', () => {
    const map = new OkxSymbolMap({ isSwap: true });

    expect(map.register({ symbol: 'BTCUSDT', instId: 'BTC-USDT-SWAP', baseAsset: 'BTC', quoteAsset: 'USDT', isSwap: true })).toBe(true);
    expect(map.register({ symbol: 'BTCUSDT', instId: 'BTCUS-DT-SWAP', baseAsset: 'BTCUS', quoteAsset: 'DT', isSwap: true })).toBe(false);
  });

  it('reports no collision when the same instrument is registered twice', () => {
    const map = new OkxSymbolMap({ isSwap: true });
    const identity = { symbol: 'BTCUSDT', instId: 'BTC-USDT-SWAP', baseAsset: 'BTC', quoteAsset: 'USDT', isSwap: true };

    map.register(identity);

    expect(map.register(identity)).toBe(true);
  });
});
