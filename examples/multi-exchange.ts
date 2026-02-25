import { Exchange } from '../src';
import pino from 'pino';

const logger = pino({ level: 'info' });

async function compareExchanges() {
  const exchanges = {
    binance: new Exchange('binance', {
      config: { apiKey: '', secret: '' },
      logger,
    }),
    bybit: new Exchange('bybit', {
      config: { apiKey: '', secret: '' },
      logger,
    }),
  };

  const symbol = 'BTCUSDT';

  try {
    console.log('Loading markets from both exchanges...');
    await exchanges.binance.futures.loadMarkets();
    await exchanges.bybit.futures.loadMarkets();

    console.log('\nFetching prices...');
    const binanceTickers = await exchanges.binance.futures.fetchTickers();
    const bybitTickers = await exchanges.bybit.futures.fetchTickers();

    const binancePrice = binanceTickers.get(symbol);
    const bybitPrice = bybitTickers.get(symbol);

    console.log(`\n${symbol} Price Comparison:`);
    console.log(`  Binance: $${binancePrice?.close}`);
    console.log(`  Bybit:   $${bybitPrice?.close}`);

    console.log('\nMarket Information:');
    console.log('Binance Markets:', exchanges.binance.futures.markets.size);
    console.log('Bybit Markets:  ', exchanges.bybit.futures.markets.size);

    console.log('\nFetching 5-day candles (1h interval)...');
    const binanceKlines = await exchanges.binance.futures.fetchKlines(symbol, '1h', {
      limit: 120,
    });
    const bybitKlines = await exchanges.bybit.futures.fetchKlines(symbol, '1h', {
      limit: 120,
    });

    console.log(`\nPrice Change (last 120 hours):`);

    if (binanceKlines.length > 0) {
      const firstKline = binanceKlines[0];
      const lastKline = binanceKlines[binanceKlines.length - 1];
      const binanceChange = ((lastKline.close - firstKline.open) / firstKline.open) * 100;

      console.log(`  Binance: ${binanceChange > 0 ? '+' : ''}${binanceChange.toFixed(2)}%`);
    }

    if (bybitKlines.length > 0) {
      const firstKline = bybitKlines[0];
      const lastKline = bybitKlines[bybitKlines.length - 1];
      const bybitChange = ((lastKline.close - firstKline.open) / firstKline.open) * 100;

      console.log(`  Bybit:   ${bybitChange > 0 ? '+' : ''}${bybitChange.toFixed(2)}%`);
    }

    console.log('\nSubscribing to real-time updates...');

    let binanceUpdates = 0;
    let bybitUpdates = 0;

    exchanges.binance.futures.subscribeKlines({
      symbol,
      interval: '1m',
      handler: (kline) => {
        binanceUpdates += 1;

        if (binanceUpdates === 1) {
          console.log(`  [Binance] First update: ${kline.close}`);
        }
      },
    });

    exchanges.bybit.futures.subscribeKlines({
      symbol,
      interval: '1m',
      handler: (kline) => {
        bybitUpdates += 1;

        if (bybitUpdates === 1) {
          console.log(`  [Bybit]   First update: ${kline.close}`);
        }
      },
    });

    await new Promise((resolve) => {
      setTimeout(resolve, 10000);
    });

    console.log(`\nUpdates received:`);
    console.log(`  Binance: ${binanceUpdates} klines`);
    console.log(`  Bybit:   ${bybitUpdates} klines`);
  } catch (error) {
    logger.error(error, 'Error during execution');
  } finally {
    await exchanges.binance.close();
    await exchanges.bybit.close();
    console.log('\nConnections closed');
  }
}

compareExchanges().catch(console.error);
