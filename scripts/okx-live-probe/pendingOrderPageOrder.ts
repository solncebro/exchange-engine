import type { OkxOrderRaw } from '../../src/normalizers/okxNormalizer';
import type { OkxProbe, OkxProbeContext, OkxProbeOutcome } from './probe.types';
import { readFarOrderBasis } from './probeOrder';
import { snapPriceToTick } from './probeSupport';
import { describeError } from '../live-support/liveError';

const CLAIM = 'Постраничный обход заявок (after = ordId) идёт от НОВОЙ записи к старой';
const EXPECTATION = 'Внутри страницы cTime убывает, и вторая страница продолжает первую более старыми записями';
const PROBE_TIMEOUT_MS = 30000;
const PAGE_LIMIT = 2;
const PROBE_ORDER_COUNT = 3;
const FAR_FROM_MARKET_RATIO = 0.5;

interface OrderPageFact {
  ordId: string;
  cTime: string;
}

function takePageFactList(orderList: OkxOrderRaw[]): OrderPageFact[] {
  return orderList.map((order) => ({ ordId: order.ordId, cTime: order.cTime }));
}

function buildPageOrderOutcome(pageOneList: OkxOrderRaw[], pageTwoList: OkxOrderRaw[]): OkxProbeOutcome {
  if (pageOneList.length < PAGE_LIMIT) {
    return {
      status: 'failed',
      fact: `на первой странице ${pageOneList.length} записей — меньше двух, порядок страниц не проверить`,
      expectation: EXPECTATION,
    };
  }

  const firstPageTimeList = pageOneList.map((order) => Number(order.cTime));
  const isFirstPageNewestFirst = firstPageTimeList.every((value, index) => index === 0 || firstPageTimeList[index - 1] >= value);

  if (pageTwoList.length === 0) {
    return {
      status: isFirstPageNewestFirst ? 'confirmed' : 'diverged',
      fact: `первая страница ${isFirstPageNewestFirst ? 'идёт от новой к старой' : 'идёт НЕ от новой к старой'}; вторая страница пуста`,
      expectation: EXPECTATION,
    };
  }

  const isSecondPageOlder = Number(pageTwoList[0].cTime) <= Number(pageOneList[pageOneList.length - 1].cTime);

  if (isFirstPageNewestFirst && isSecondPageOlder) {
    return { status: 'confirmed', fact: 'страница идёт от новой к старой, вторая страница продолжает её более старыми записями', expectation: EXPECTATION };
  }

  return {
    status: 'diverged',
    fact: `внутри страницы порядок ${isFirstPageNewestFirst ? 'от новой к старой' : 'иной'}, вторая страница ${isSecondPageOlder ? 'старее' : 'НЕ старее'} первой`,
    expectation: EXPECTATION,
  };
}

async function readOrderHistoryPages(context: OkxProbeContext): Promise<OkxProbeOutcome> {
  const pageOneList = await context.httpClient.fetchOrderHistory({ instType: 'SWAP', isArchive: false, limit: PAGE_LIMIT });

  context.showEvidence('первая страница orders-history (дословно)', pageOneList);

  if (pageOneList.length === 0) {
    return { status: 'failed', fact: 'история заявок пуста — порядок страниц не проверить', expectation: EXPECTATION };
  }

  const pageTwoList = await context.httpClient.fetchOrderHistory({
    instType: 'SWAP',
    isArchive: false,
    limit: PAGE_LIMIT,
    after: pageOneList[pageOneList.length - 1].ordId,
  });

  context.showEvidence('вторая страница orders-history (дословно)', pageTwoList);
  context.showEvidence('ordId и cTime по страницам', { page1: takePageFactList(pageOneList), page2: takePageFactList(pageTwoList) });

  return buildPageOrderOutcome(pageOneList, pageTwoList);
}

async function placeProbeOrderList(context: OkxProbeContext): Promise<string[]> {
  const basis = await readFarOrderBasis(context);
  const orderIdList: string[] = [];

  for (let index = 0; index < PROBE_ORDER_COUNT; index++) {
    const params: Record<string, unknown> = {
      instId: context.settings.instId,
      tdMode: 'cross',
      side: 'buy',
      ordType: 'limit',
      sz: basis.instrument.minSz,
      px: snapPriceToTick(basis.lastPrice * FAR_FROM_MARKET_RATIO - index * Number(basis.instrument.tickSz), basis.instrument.tickSz),
      clOrdId: context.buildClientOrderId(),
    };

    if (basis.isHedgeMode) {
      params.posSide = 'long';
    }

    const result = await context.httpClient.placeOrder(params);

    context.showEvidence(`постановка заявки ${index + 1} (дословно)`, result);
    orderIdList.push(result.ordId);
  }

  return orderIdList;
}

async function readPendingOrderPages(context: OkxProbeContext): Promise<OkxProbeOutcome> {
  const orderIdList = await placeProbeOrderList(context);

  try {
    const pageOneList = await context.httpClient.fetchPendingOrders({
      instType: 'SWAP',
      instId: context.settings.instId,
      limit: PAGE_LIMIT,
    });

    context.showEvidence('первая страница orders-pending (дословно)', pageOneList);

    if (pageOneList.length === 0) {
      return { status: 'failed', fact: 'открытых заявок биржа не показала сразу после постановки', expectation: EXPECTATION };
    }

    const pageTwoList = await context.httpClient.fetchPendingOrders({
      instType: 'SWAP',
      instId: context.settings.instId,
      limit: PAGE_LIMIT,
      after: pageOneList[pageOneList.length - 1].ordId,
    });

    context.showEvidence('вторая страница orders-pending (дословно)', pageTwoList);
    context.showEvidence('ordId и cTime по страницам', { page1: takePageFactList(pageOneList), page2: takePageFactList(pageTwoList) });

    return buildPageOrderOutcome(pageOneList, pageTwoList);
  } finally {
    for (const orderId of orderIdList) {
      await context.httpClient
        .cancelOrder({ instId: context.settings.instId, ordId: orderId })
        .then((result) => context.showEvidence('уборка: снятие заявки (дословно)', result))
        .catch((error: unknown) => context.showEvidence('уборка: снять заявку не удалось', describeError(error)));
    }
  }
}

async function runPendingOrderPageOrderProbe(context: OkxProbeContext): Promise<OkxProbeOutcome> {
  if (!context.settings.isOrderAllowed) {
    context.showEvidence('без ключа --allow-orders порядок читается по истории заявок', 'orders-history вместо orders-pending');

    return readOrderHistoryPages(context);
  }

  return readPendingOrderPages(context);
}

export const pendingOrderPageOrderProbe: OkxProbe = {
  claim: CLAIM,
  timeoutMs: PROBE_TIMEOUT_MS,
  isOrdersRequired: false,
  run: runPendingOrderPageOrderProbe,
};
