import { Exchange } from '../src';
import pino from 'pino';

const logger = pino({ level: 'info' });

async function main() {
  const exchange = new Exchange('binance', {
    config: {
      apiKey: process.env.BINANCE_API_KEY ?? '',
      secret: process.env.BINANCE_SECRET ?? '',
    },
    logger,
  });

  try {
    console.log('Loading markets...');
    await exchange.futures.loadMarkets();
    await exchange.spot.loadMarkets();

    const futuresMarketsCount = exchange.futures.markets.size;
    const futuresSymbols = Array.from(exchange.futures.markets.keys()).slice(0, 5);

    console.log(`Found ${futuresMarketsCount} futures symbols`);
    console.log(`First 5 symbols: ${futuresSymbols.join(', ')}`);

    console.log('\nFetching tickers...');
    const tickers = await exchange.futures.fetchTickers();
    const btcTicker = tickers.get('BTCUSDT');

    if (btcTicker) {
      console.log(
        `BTC Price: $${btcTicker.close}, 24h Change: ${btcTicker.percentage.toFixed(2)}%`
      );
    }

    console.log('\nFetching historical klines (last 10 hours)...');
    const klines = await exchange.futures.fetchKlines('BTCUSDT', '1h', { limit: 10 });
    const lastKline = klines[klines.length - 1];

    console.log(`Last kline: Open $${lastKline.open}, Close $${lastKline.close}`);

    if (process.env.BINANCE_API_KEY) {
      const balance = await exchange.futures.fetchBalances();
      const usdtBalance = balance.get('USDT');

      if (usdtBalance) {
        console.log(
          `\nAccount Balance: Free $${usdtBalance.free}, Locked $${usdtBalance.locked}`
        );
      }

      const position = await exchange.futures.fetchPosition('BTCUSDT');

      if (position) {
        console.log(
          `Position: ${position.contracts} contracts, Leverage: ${position.leverage}x, Entry: $${position.entryPrice}`
        );
      }
    }

    console.log('\nSubscribing to BTC 1-minute klines...');
    exchange.futures.subscribeKlines({
      symbol: 'BTCUSDT',
      interval: '1m',
      handler: (kline) => {
        const time = new Date(kline.openTime).toISOString();

        console.log(
          `[${time}] BTC: O:${kline.open} H:${kline.high} L:${kline.low} C:${kline.close}`
        );
      },
    });

    await new Promise((resolve) => {
      setTimeout(resolve, 30000);
    });
  } catch (error) {
    logger.error(error, 'Error during execution');
  } finally {
    await exchange.close();
    console.log('\nConnection closed');
  }
}

main().catch(console.error);
