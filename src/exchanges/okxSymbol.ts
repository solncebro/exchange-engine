import { OKX_QUOTE_CURRENCY_LIST } from '../constants/okx';
import { ExchangeError } from '../errors/ExchangeError';
import type { OkxInstrumentIdentity, OkxSymbolMapArgs, BuildOkxInstIdFallbackArgs } from './okxSymbol.types';

export function parseOkxInstId(instId: string): OkxInstrumentIdentity | null {
  const partList = instId.split('-');

  if (partList.length !== 2 && !(partList.length === 3 && partList[2] === 'SWAP')) {
    return null;
  }

  const [baseAsset, quoteAsset] = partList;

  if (baseAsset === '' || quoteAsset === '') {
    return null;
  }

  return {
    symbol: `${baseAsset}${quoteAsset}`,
    instId,
    baseAsset,
    quoteAsset,
    isSwap: partList.length === 3,
  };
}

export function buildOkxInstIdFallback(args: BuildOkxInstIdFallbackArgs): string | null {
  const { symbol, isSwap } = args;

  const matchingQuoteList = OKX_QUOTE_CURRENCY_LIST.filter((quoteAsset) => symbol.endsWith(quoteAsset));

  if (matchingQuoteList.length === 0) {
    return null;
  }

  const quoteAsset = matchingQuoteList.sort((left, right) => right.length - left.length)[0];
  const baseAsset = symbol.slice(0, symbol.length - quoteAsset.length);

  if (baseAsset === '') {
    return null;
  }

  return isSwap ? `${baseAsset}-${quoteAsset}-SWAP` : `${baseAsset}-${quoteAsset}`;
}

export class OkxSymbolMap {
  private readonly isSwap: boolean;
  private readonly instIdBySymbol = new Map<string, string>();
  private readonly symbolByInstId = new Map<string, string>();
  private readonly instIdCodeBySymbol = new Map<string, number>();

  constructor(args: OkxSymbolMapArgs) {
    this.isSwap = args.isSwap;
  }

  /**
   * Возвращает `false`, если это ОБЩЕЕ имя уже занято ДРУГИМ обозначением биржи. Два инструмента,
   * дающие одно имя, затирали друг друга без единого признака, и заявки по «затёртому» уходили бы
   * на другой инструмент. Карта в журнал не пишет (у неё его нет) — признак столкновения уходит
   * наружу, и предупреждает клиент.
   */
  register(identity: OkxInstrumentIdentity, instIdCode?: number | null): boolean {
    const registeredInstId = this.instIdBySymbol.get(identity.symbol);
    const isCollision = registeredInstId !== undefined && registeredInstId !== identity.instId;

    this.instIdBySymbol.set(identity.symbol, identity.instId);
    this.symbolByInstId.set(identity.instId, identity.symbol);
    this.registerInstIdCode(identity.symbol, instIdCode);

    return !isCollision;
  }

  clear(): void {
    this.instIdBySymbol.clear();
    this.symbolByInstId.clear();
    this.instIdCodeBySymbol.clear();
  }

  has(symbol: string): boolean {
    return this.instIdBySymbol.has(symbol);
  }

  resolveInstId(symbol: string): string {
    const registeredInstId = this.instIdBySymbol.get(symbol);

    if (registeredInstId !== undefined) {
      return registeredInstId;
    }

    const fallbackInstId = buildOkxInstIdFallback({ symbol, isSwap: this.isSwap });

    if (fallbackInstId !== null) {
      return fallbackInstId;
    }

    throw new ExchangeError(`OKX instrument for symbol ${symbol} cannot be resolved`, 'OKX_SYMBOL_UNRESOLVED', 'OKX');
  }

  /**
   * Числовой код инструмента — единственный адрес, который понимает торговый канал: в таблице
   * параметров всех шести его операций стоит `instIdCode` (Integer), и заявка с именем инструмента
   * отвергается («Parameter instIdCode can not be empty», живая проба на демо-счёте 09.09.2026).
   *
   * Запасного правила здесь нет и быть не может: код из имени НЕ выводится (дословно из
   * документации — «Users must map instIdCode to instId»), а любое подставленное число адресует
   * ЧУЖОЙ инструмент, то есть заявка ушла бы не туда. Поэтому неизвестный код — отказ, а не
   * догадка; вызывающий отправляет заявку обычным запросом, который работает по имени.
   */
  resolveInstIdCode(symbol: string): number {
    const registeredInstIdCode = this.instIdCodeBySymbol.get(symbol);

    if (registeredInstIdCode !== undefined) {
      return registeredInstIdCode;
    }

    if (this.instIdCodeBySymbol.size === 0) {
      throw new ExchangeError(
        `OKX instrument codes are not loaded — loadTradeSymbols must run before ${symbol} goes to the trade channel`,
        'OKX_INSTRUMENTS_NOT_LOADED',
        'OKX',
      );
    }

    throw new ExchangeError(
      `OKX instrument code for symbol ${symbol} cannot be resolved`,
      'OKX_SYMBOL_UNRESOLVED',
      'OKX',
    );
  }

  resolveSymbol(instId: string): string {
    const registeredSymbol = this.symbolByInstId.get(instId);

    if (registeredSymbol !== undefined) {
      return registeredSymbol;
    }

    const parsedIdentity = parseOkxInstId(instId);

    if (parsedIdentity !== null && parsedIdentity.isSwap === this.isSwap) {
      return parsedIdentity.symbol;
    }

    throw new ExchangeError(`OKX instrument for instId ${instId} cannot be resolved`, 'OKX_SYMBOL_UNRESOLVED', 'OKX');
  }

  size(): number {
    return this.instIdBySymbol.size;
  }

  /**
   * Код перезаписывается ровно тем, что пришло с текущей загрузкой, а без кода — стирается.
   * Дословно из документации: «instIdCode will change if a trading symbol is relisted» — то есть
   * оставленный от прошлой загрузки код после перелистинга адресует уже другой инструмент, и
   * заявка по нему ушла бы молча не туда. Отсутствие кода стоит дешевле: канал откажет, и заявка
   * уйдёт обычным запросом.
   */
  private registerInstIdCode(symbol: string, instIdCode?: number | null): void {
    if (typeof instIdCode !== 'number' || !Number.isInteger(instIdCode) || instIdCode <= 0) {
      this.instIdCodeBySymbol.delete(symbol);

      return;
    }

    this.instIdCodeBySymbol.set(symbol, instIdCode);
  }
}
