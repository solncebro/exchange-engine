import { ReliableWebSocket } from '@solncebro/websocket-engine';

import { ExchangeError } from '../errors/ExchangeError';
import type { OkxSymbolMap } from '../exchanges/okxSymbol';
import { buildOkxBatchItemResult, buildOkxCreateOutcome } from '../normalizers/okxNormalizer';
import type { OkxOrderResultRaw } from '../normalizers/okxNormalizer';
import { MISSING_ORDER_ID_ERROR_TEXT } from '../normalizers/batchOrderOutcome';
import {
  OKX_BATCH_ACCEPTED_CODE_LIST,
  OKX_ORDER_CHANNEL_INSTID_ISSUE_CODE_LIST,
  OKX_ORDER_CHANNEL_INSTID_ISSUE_TEXT,
  OKX_SERVICE_UPGRADE_NOTICE_CODE,
  OKX_SERVICE_UPGRADE_RECONNECT_DEADLINE_MS,
} from '../constants/okx';
import type { Order } from '../types/common';
import type {
  CancelBatchOrdersResult,
  CreateBatchOrdersResult,
  CreateOrderWebSocketArgs,
  ModifyBatchOrdersResult,
} from '../types/exchange';
import { BaseTradeStream } from './BaseTradeStream';
import type { PendingRequest } from './BaseTradeStream.types';
import { PendingRequestKind } from './BaseTradeStream.types';
import { authenticateOkxWebSocket } from './okxWebSocketAuth';
import { OKX_HEARTBEAT_CONFIG, OKX_WEBSOCKET_CONFIGURATION, parseOkxWebSocketMessage } from './okxWebSocketUtils';
import { toOkxErrorCode } from '../utils/okxErrorCode';
import { buildMinimalTradeStreamOrder } from './tradeStreamOrder';
import type {
  OkxCancelOrderParams,
  OkxPendingBatchContext,
  OkxTradeAnyMessage,
  OkxTradeResponseMessage,
  OkxTradeStreamArgs,
} from './OkxTradeStream.types';

const OKX_OP_KIND_BY_OP: Record<string, PendingRequestKind> = {
  order: PendingRequestKind.SingleOrder,
  'cancel-order': PendingRequestKind.SingleCancel,
  'amend-order': PendingRequestKind.SingleAmend,
  'batch-orders': PendingRequestKind.CreateBatch,
  'batch-amend-orders': PendingRequestKind.ModifyBatch,
  'batch-cancel-orders': PendingRequestKind.CancelBatch,
};

const OKX_TRADE_STREAM_KIND_MISMATCH_CODE = 'OKX_TRADE_STREAM_KIND_MISMATCH';

class OkxTradeStream extends BaseTradeStream<OkxTradeAnyMessage> {
  private readonly passphrase: string;
  private readonly symbolMap: OkxSymbolMap;
  private readonly pendingBatchContextByReqId: Map<string, OkxPendingBatchContext> = new Map();
  private reconnectDeadlineTimerId: ReturnType<typeof setTimeout> | undefined;
  private orderChannelUsable = true;

  constructor(args: OkxTradeStreamArgs) {
    super(args);
    this.passphrase = args.passphrase;
    this.symbolMap = args.symbolMap;
  }

  async createOrder(orderParams: Record<string, unknown>): Promise<Order> {
    await this.ensureConnectedHook();

    const requestId = this.generateReqId();
    const request = this.buildOrderRequest(orderParams, requestId);

    return this.sendRequest<Order>(request, requestId, PendingRequestKind.SingleOrder);
  }

  async cancelOrder(params: OkxCancelOrderParams): Promise<OkxOrderResultRaw> {
    await this.ensureConnectedHook();

    const requestId = this.generateReqId();
    const request = { id: requestId, op: 'cancel-order', args: [this.toChannelArgs({ ...params })] };

    return this.sendRequest<OkxOrderResultRaw>(request, requestId, PendingRequestKind.SingleCancel);
  }

  async amendOrder(params: Record<string, unknown>): Promise<OkxOrderResultRaw> {
    await this.ensureConnectedHook();

    const requestId = this.generateReqId();
    const request = { id: requestId, op: 'amend-order', args: [this.toChannelArgs(params)] };

    return this.sendRequest<OkxOrderResultRaw>(request, requestId, PendingRequestKind.SingleAmend);
  }

  async createBatchOrders(
    originalArgsList: CreateOrderWebSocketArgs[],
    requestPayloadList: Array<Record<string, unknown>>,
    sentAmountList: number[],
  ): Promise<CreateBatchOrdersResult> {
    await this.ensureConnectedHook();

    const requestId = this.generateReqId();
    const request = { id: requestId, op: 'batch-orders', args: this.toChannelArgsList(requestPayloadList) };

    this.pendingBatchContextByReqId.set(requestId, { kind: 'create', originalArgsList, sentAmountList });

    try {
      return await this.sendRequest<CreateBatchOrdersResult>(request, requestId, PendingRequestKind.CreateBatch);
    } catch (error) {
      this.pendingBatchContextByReqId.delete(requestId);

      throw error;
    }
  }

  async modifyBatchOrders(
    originalOrderIdList: string[],
    requestPayloadList: Array<Record<string, unknown>>,
  ): Promise<ModifyBatchOrdersResult> {
    await this.ensureConnectedHook();

    const requestId = this.generateReqId();
    const request = { id: requestId, op: 'batch-amend-orders', args: this.toChannelArgsList(requestPayloadList) };

    this.pendingBatchContextByReqId.set(requestId, { kind: 'modify', originalOrderIdList });

    try {
      return await this.sendRequest<ModifyBatchOrdersResult>(request, requestId, PendingRequestKind.ModifyBatch);
    } catch (error) {
      this.pendingBatchContextByReqId.delete(requestId);

      throw error;
    }
  }

  async cancelBatchOrders(
    originalOrderIdList: string[],
    requestPayloadList: Array<Record<string, unknown>>,
  ): Promise<CancelBatchOrdersResult> {
    await this.ensureConnectedHook();

    const requestId = this.generateReqId();
    const request = { id: requestId, op: 'batch-cancel-orders', args: this.toChannelArgsList(requestPayloadList) };

    this.pendingBatchContextByReqId.set(requestId, { kind: 'cancel', originalOrderIdList });

    try {
      return await this.sendRequest<CancelBatchOrdersResult>(request, requestId, PendingRequestKind.CancelBatch);
    } catch (error) {
      this.pendingBatchContextByReqId.delete(requestId);

      throw error;
    }
  }

  isOrderChannelUsable(): boolean {
    return this.orderChannelUsable;
  }

  disconnect(): void {
    this.clearReconnectDeadline();
    super.disconnect();
  }

  protected buildOrderRequest(orderParams: Record<string, unknown>, requestId: string): unknown {
    return { id: requestId, op: 'order', args: [this.toChannelArgs(orderParams)] };
  }

  protected generateReqId(): string {
    return `r${Date.now()}${Math.random().toString(36).slice(2, 10)}`;
  }

  protected initConnection(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let isResolved = false;

      this.webSocket = new ReliableWebSocket<OkxTradeAnyMessage>({
        label: this.label,
        url: this.url,
        logger: this.logger,
        parseMessage: (rawData) => parseOkxWebSocketMessage(rawData),
        onMessage: (message) => this.handleMessage(message),
        onOpen: async (context) => {
          try {
            await authenticateOkxWebSocket({
              context,
              apiKey: this.apiKey,
              secret: this.secret,
              passphrase: this.passphrase,
              label: this.label,
              logger: this.logger,
            });

            if (!isResolved) {
              isResolved = true;
              resolve();
            }
          } catch (error) {
            this.noteLoginFailure(error);

            if (!isResolved) {
              isResolved = true;
              reject(error);
            }

            throw error;
          }
        },
        onNotify: this.onNotify,
        heartbeat: OKX_HEARTBEAT_CONFIG,
        configuration: OKX_WEBSOCKET_CONFIGURATION,
      });
    });
  }

  /**
   * Торговый канал OKX адресует инструмент ЧИСЛОМ: в таблице параметров всех шести его операций
   * стоит `instIdCode` (Integer), а не имя `instId`, и заявка с именем отвергается — «Parameter
   * instIdCode can not be empty», код 50014 (живая проба на демо-счёте 09.09.2026). Обычные
   * запросы устроены наоборот, они понимают только имя, поэтому подмена делается ЗДЕСЬ, на
   * границе канала: сборщики параметров остаются общими для обоих путей, и отправка тем же
   * набором полей обычным запросом остаётся возможной.
   *
   * Неизвестный код — отказ до отправки: заявка не уходит вовсе, и вызывающий волен повторить её
   * обычным запросом, зная, что в книге её нет.
   */
  private toChannelArgs(params: Record<string, unknown>): Record<string, unknown> {
    const { instId, ...restParams } = params;

    if (typeof instId !== 'string' || instId === '') {
      throw new ExchangeError(
        'OKX trade channel request carries no instId to address the instrument by',
        'OKX_SYMBOL_UNRESOLVED',
        'OKX',
      );
    }

    const instIdCode = this.symbolMap.resolveInstIdCode(this.symbolMap.resolveSymbol(instId));

    return { ...restParams, instIdCode };
  }

  private toChannelArgsList(paramsList: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
    return paramsList.map((params) => this.toChannelArgs(params));
  }

  /**
   * Провал входа обязан кончиться разрывом, а не молчанием. Признак `isResolved` встаёт на первом
   * удачном открытии и остаётся навсегда, поэтому при каждом последующем переподключении отказ входа
   * попадал в перехват, где не делалось НИЧЕГО: обещание `onOpen` разрешалось штатно, движок ставил
   * состояние «подключено», `isConnected()` отвечал правдой — и заявки уходили в неавторизованный
   * сокет, получая от биржи «Please log in». Проверки живости при этом тоже не начинались (движок
   * заводит их только после того, как `onOpen` разрешится), то есть единственный прикладной способ
   * заметить беду был выключен.
   *
   * Ошибка пробрасывается наружу из `onOpen`: движок пишет отказ, снимает сокет и запускает
   * переподключение (`handleDisruption`) — то есть повторную попытку входа. Первое открытие вдобавок
   * отклоняет обещание подключения, чтобы вызывающий узнал об отказе сразу.
   */
  private noteLoginFailure(error: unknown): void {
    this.logger.error(`${this.label}: login failed on open — the socket is not usable: ${error instanceof Error ? error.message : String(error)}`);
  }

  private handleMessage(message: OkxTradeAnyMessage): void {
    const requestId = message.id;

    if (requestId === undefined) {
      this.handleServiceFrame(message);

      return;
    }

    const pending = this.takePendingRequest(requestId);

    if (!pending) {
      this.pendingBatchContextByReqId.delete(requestId);
      this.logger.warn({ requestId, op: 'op' in message ? message.op : undefined }, `${this.label}: orphan response (no pending request)`);

      return;
    }

    try {
      this.routePendingResponse(message, pending, requestId);
    } catch (error) {
      this.pendingBatchContextByReqId.delete(requestId);
      pending.reject(error instanceof Error ? error : new Error(String(error)));
    }

    this.reconnectWhenRequestsSettled();
  }

  /**
   * Кадр без номера запроса — это либо отказ сервера, либо уведомление. Уведомление о плановом
   * разрыве (код 64008) биржа шлёт за минуту до него и прямо просит переподключиться: пока канал
   * свободен, переоткрываемся сами — ответ на заявку, отправленную перед самым обрывом, иначе придёт
   * в закрытый сокет, а вызывающий узнает об этом только по тайм-ауту через тридцать секунд. Если
   * заявки в полёте есть, трогать соединение нельзя: разрыв отверг бы их все, хотя биржа могла их
   * принять, — тогда переоткрытие ОТКЛАДЫВАЕТСЯ до последнего ответа. Прочие служебные кадры больше
   * не пропадают молча.
   */
  private handleServiceFrame(message: OkxTradeAnyMessage): void {
    if (message.event === 'error') {
      this.logger.error({ code: message.code, msg: message.msg }, `${this.label}: server error`);

      return;
    }

    if (message.event !== 'notice') {
      return;
    }

    if (message.code !== OKX_SERVICE_UPGRADE_NOTICE_CODE) {
      this.logger.warn(`${this.label}: server notice (${message.code ?? ''}) ${message.msg ?? ''}`);

      return;
    }

    if (this.pendingRequestByRequestId.size > 0) {
      this.logger.info(`${this.label}: server notice (${message.code}) — ${this.pendingRequestByRequestId.size} request(s) in flight, reopening as soon as the last answer arrives`);
      this.deferReconnectUntilRequestsSettle();

      return;
    }

    this.logger.info(`${this.label}: server notice (${message.code}) ${message.msg ?? ''} — reconnecting ahead of the planned disconnect`);
    this.reconnectAheadOfPlannedDisconnect();
  }

  /**
   * Уведомление о плановом разрыве приходит РОВНО ОДИН раз. Пока оно просто писалось в журнал,
   * подаренная биржей минута пропадала целиком именно в том случае, ради которого её и дают: заявки
   * в полёте живут не дольше тайм-аута запроса, то есть полминуты у нас оставалось, но воспользоваться
   * ими было некому — второго уведомления не будет. Признак «переоткрыться, как освободимся» живёт в
   * таймере срока: он же и предохранитель на случай, когда ответ не придёт вовсе и последнего кадра,
   * на котором можно очнуться, не случится.
   */
  private deferReconnectUntilRequestsSettle(): void {
    if (this.reconnectDeadlineTimerId !== undefined) {
      return;
    }

    this.reconnectDeadlineTimerId = setTimeout(() => {
      this.reconnectDeadlineTimerId = undefined;

      if (this.pendingRequestByRequestId.size > 0) {
        this.logger.warn(`${this.label}: ${this.pendingRequestByRequestId.size} request(s) still in flight at the reconnect deadline — leaving the break to the exchange`);

        return;
      }

      this.logger.info(`${this.label}: no request left in flight — reconnecting ahead of the planned disconnect`);
      this.reconnectAheadOfPlannedDisconnect();
    }, OKX_SERVICE_UPGRADE_RECONNECT_DEADLINE_MS);
    this.reconnectDeadlineTimerId.unref?.();
  }

  private reconnectWhenRequestsSettled(): void {
    if (this.reconnectDeadlineTimerId === undefined || this.pendingRequestByRequestId.size > 0) {
      return;
    }

    this.clearReconnectDeadline();
    this.logger.info(`${this.label}: the last request in flight is answered — reconnecting ahead of the planned disconnect`);
    this.reconnectAheadOfPlannedDisconnect();
  }

  private clearReconnectDeadline(): void {
    if (this.reconnectDeadlineTimerId === undefined) {
      return;
    }

    clearTimeout(this.reconnectDeadlineTimerId);
    this.reconnectDeadlineTimerId = undefined;
  }

  private reconnectAheadOfPlannedDisconnect(): void {
    this.disconnect();

    this.connect().catch((error) => {
      this.logger.error(`${this.label}: reconnect after the service upgrade notice failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  private routePendingResponse(message: OkxTradeAnyMessage, pending: PendingRequest, requestId: string): void {
    if (!('op' in message)) {
      pending.reject(new ExchangeError(message.msg ?? 'OKX request error', toOkxErrorCode(message.code ?? ''), 'OKX'));

      return;
    }

    const expectedKind = OKX_OP_KIND_BY_OP[message.op];

    if (expectedKind === undefined || pending.kind !== expectedKind) {
      this.pendingBatchContextByReqId.delete(requestId);
      pending.reject(new ExchangeError(`Unexpected pending kind for OKX '${message.op}' response`, OKX_TRADE_STREAM_KIND_MISMATCH_CODE, 'OKX'));

      return;
    }

    if (message.op === 'order' || message.op === 'cancel-order' || message.op === 'amend-order') {
      this.handleSingleResponse(message, pending);

      return;
    }

    if (message.op === 'batch-orders' || message.op === 'batch-amend-orders' || message.op === 'batch-cancel-orders') {
      this.handleBatchResponse(message, pending, requestId);
    }
  }

  private handleSingleResponse(message: OkxTradeResponseMessage, pending: PendingRequest): void {
    const item = (message.data ?? [])[0];

    if (message.code === '0' && item !== undefined) {
      if (message.op !== 'order') {
        pending.resolve(item);

        return;
      }

      if (item.ordId === '') {
        pending.reject(new ExchangeError(MISSING_ORDER_ID_ERROR_TEXT, 'OKX_EMPTY_ORDER_ID', 'OKX'));

        return;
      }

      pending.resolve(buildMinimalTradeStreamOrder(item.ordId, item.clOrdId));

      return;
    }

    pending.reject(this.buildOkxSingleRequestError(message, item));
  }

  private buildOkxSingleRequestError(message: OkxTradeResponseMessage, item: OkxOrderResultRaw | undefined): ExchangeError {
    if (item !== undefined && item.sCode !== '0') {
      this.markOrderChannelUnusableIfInstIdCode(item.sCode, item.sMsg);

      return new ExchangeError(`OKX order error ${item.sCode}: ${item.sMsg}`, toOkxErrorCode(item.sCode ?? ''), 'OKX');
    }

    this.markOrderChannelUnusableIfInstIdCode(message.code, message.msg);

    return new ExchangeError(`OKX request error ${message.code}: ${message.msg}`, toOkxErrorCode(message.code ?? ''), 'OKX');
  }

  private handleBatchResponse(message: OkxTradeResponseMessage, pending: PendingRequest, requestId: string): void {
    const context = this.pendingBatchContextByReqId.get(requestId);
    this.pendingBatchContextByReqId.delete(requestId);

    if (context === undefined) {
      pending.reject(new ExchangeError(`Missing batch context for OKX '${message.op}' response`, 'OKX_BATCH_CONTEXT_MISSING', 'OKX'));

      return;
    }

    if (!OKX_BATCH_ACCEPTED_CODE_LIST.includes(message.code)) {
      this.markOrderChannelUnusableIfInstIdCode(message.code, message.msg);
      pending.reject(new ExchangeError(`OKX request error ${message.code}: ${message.msg}`, toOkxErrorCode(message.code ?? ''), 'OKX'));

      return;
    }

    const itemList = message.data ?? [];
    this.markOrderChannelUnusableIfAllBatchItemsHaveInstIdCodeIssue(itemList);

    if (context.kind === 'create') {
      const resultList: CreateBatchOrdersResult = context.originalArgsList.map(
        (args, index) => buildOkxCreateOutcome(args, itemList[index], context.sentAmountList[index]),
      );

      pending.resolve(resultList);

      return;
    }

    const resultList = context.originalOrderIdList.map(
      (orderId, index) => buildOkxBatchItemResult(orderId, itemList[index]),
    );

    pending.resolve(resultList);
  }

  private markOrderChannelUnusableIfAllBatchItemsHaveInstIdCodeIssue(itemList: OkxOrderResultRaw[]): void {
    if (itemList.length === 0) {
      return;
    }

    const allItemsHaveInstIdCodeIssue = itemList.every(
      (item) => OKX_ORDER_CHANNEL_INSTID_ISSUE_CODE_LIST.includes(item.sCode) && (item.sMsg ?? '').includes(OKX_ORDER_CHANNEL_INSTID_ISSUE_TEXT),
    );

    if (!allItemsHaveInstIdCodeIssue) {
      return;
    }

    this.markOrderChannelUnusableIfInstIdCode(itemList[0].sCode, itemList[0].sMsg);
  }

  /**
   * Поля `sCode`/`sMsg`/`code`/`msg` объявлены обязательными, но приходят с провода: пропуск любого
   * из них превращал понятный отказ биржи в `TypeError` про чтение свойства у `undefined`, и до
   * вызывающего доезжал он, а не текст ошибки.
   */
  private markOrderChannelUnusableIfInstIdCode(code: string | undefined, message: string | undefined): void {
    if (!OKX_ORDER_CHANNEL_INSTID_ISSUE_CODE_LIST.includes(code ?? '') || !(message ?? '').includes(OKX_ORDER_CHANNEL_INSTID_ISSUE_TEXT)) {
      return;
    }

    if (!this.orderChannelUsable) {
      return;
    }

    this.orderChannelUsable = false;
    this.logger.error({ code, msg: message }, `${this.label}: OKX order channel unusable (instIdCode mismatch)`);
  }
}

export { OkxTradeStream };
