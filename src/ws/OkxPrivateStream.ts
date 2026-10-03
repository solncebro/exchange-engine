import { ReliableWebSocket, WebSocketStatus } from '@solncebro/websocket-engine';
import type { WebSocketOpenContext } from '@solncebro/websocket-engine';

import { OKX_SERVICE_UPGRADE_NOTICE_CODE } from '../constants/okx';
import type { ExchangeLogger, WebSocketConnectionInfo } from '../types/common';
import { WebSocketConnectionTypeEnum } from '../types/common';
import { authenticateOkxWebSocket } from './okxWebSocketAuth';
import { OKX_HEARTBEAT_CONFIG, OKX_WEBSOCKET_CONFIGURATION, parseOkxWebSocketMessage } from './okxWebSocketUtils';
import type { OkxSubscriptionArg, OkxWebSocketMessage } from './okxWebSocketUtils.types';
import type { OkxPrivateStreamArgs } from './OkxPrivateStream.types';

function buildOkxSubscriptionLabel(arg: OkxSubscriptionArg): string {
  const instTypeSuffix = arg.instType !== undefined ? ` ${arg.instType}` : '';
  const instIdSuffix = arg.instId !== undefined ? ` ${arg.instId}` : '';

  return `${arg.channel}${instTypeSuffix}${instIdSuffix}`;
}

/**
 * Отказ биржи описывает тему ровно теми полями, которые она сочла нужным вернуть: `instType` и
 * `instId` в ответе необязательны. Поэтому совпадение требуется только по тем полям, которые в
 * отказе названы, — иначе отказ по `{channel: 'orders'}` не опознал бы нашу подписку
 * `{channel: 'orders', instType: 'SWAP'}` и список продолжил бы врать.
 */
function matchesRefusedSubscriptionArg(subscriptionArg: OkxSubscriptionArg, refusedArg: OkxSubscriptionArg): boolean {
  if (subscriptionArg.channel !== refusedArg.channel) {
    return false;
  }

  if (refusedArg.instType !== undefined && subscriptionArg.instType !== refusedArg.instType) {
    return false;
  }

  return refusedArg.instId === undefined || subscriptionArg.instId === refusedArg.instId;
}

class OkxPrivateStream {
  private readonly logger: ExchangeLogger;
  private readonly label: string;
  private readonly url: string;
  private readonly apiKey: string;
  private readonly secret: string;
  private readonly passphrase: string;
  private readonly onNotify?: (message: string) => void | Promise<void>;
  private readonly onMessageHandler: (message: OkxWebSocketMessage) => void;
  private readonly subscriptionArgList: OkxSubscriptionArg[];
  private readonly refusedSubscriptionLabelSet: Set<string> = new Set();
  private readonly onConnectionLost?: () => void;
  private readonly onConnectionRestored?: () => void;
  private webSocket: ReliableWebSocket<OkxWebSocketMessage> | null = null;

  constructor(args: OkxPrivateStreamArgs) {
    this.logger = args.logger;
    this.label = args.label;
    this.url = args.url;
    this.apiKey = args.apiKey;
    this.secret = args.secret;
    this.passphrase = args.passphrase;
    this.onNotify = args.onNotify;
    this.onMessageHandler = args.onMessage;
    this.subscriptionArgList = args.subscriptionArgList;
    this.onConnectionLost = args.onConnectionLost;
    this.onConnectionRestored = args.onConnectionRestored;
  }

  connect(): void {
    if (this.webSocket !== null) {
      return;
    }

    this.webSocket = new ReliableWebSocket<OkxWebSocketMessage>({
      label: this.label,
      url: this.url,
      logger: this.logger,
      parseMessage: (rawData) => parseOkxWebSocketMessage(rawData),
      onMessage: (message) => this.handleMessage(message),
      onOpen: (context) => this.authenticate(context),
      onNotify: this.onNotify,
      onClose: () => this.onConnectionLost?.(),
      onReconnectSuccess: () => this.onConnectionRestored?.(),
      heartbeat: OKX_HEARTBEAT_CONFIG,
      configuration: OKX_WEBSOCKET_CONFIGURATION,
    });
  }

  close(): void {
    if (this.webSocket !== null) {
      this.webSocket.close();
      this.webSocket = null;
    }
  }

  isConnected(): boolean {
    return this.webSocket !== null && this.webSocket.getStatus() === WebSocketStatus.CONNECTED;
  }

  getConnectionInfo(): WebSocketConnectionInfo | null {
    if (this.webSocket === null) {
      return null;
    }

    return {
      label: this.label,
      url: this.url,
      isConnected: this.isConnected(),
      type: WebSocketConnectionTypeEnum.UserData,
      subscriptionList: this.subscriptionArgList
        .map(buildOkxSubscriptionLabel)
        .filter((label) => !this.refusedSubscriptionLabelSet.has(label)),
    };
  }

  /**
   * Список подписок обязан показывать ПРИНЯТОЕ биржей, а не запрошенное нами — как в публичном
   * потоке. Пока отвергнутая тема оставалась в списке, наблюдатель видел «соединение подключено,
   * канал подписан» и считал поток здоровым, хотя по этому каналу не придёт ни события. Запрошенный
   * список не трогаем: он нужен, чтобы подписаться заново на следующем открытии сокета, — и там же
   * пометки отказа снимаются, потому что попытка делается новая.
   */
  private forgetRefusedSubscription(refusedArg: OkxSubscriptionArg): void {
    for (const subscriptionArg of this.subscriptionArgList) {
      if (matchesRefusedSubscriptionArg(subscriptionArg, refusedArg)) {
        this.refusedSubscriptionLabelSet.add(buildOkxSubscriptionLabel(subscriptionArg));
      }
    }
  }

  /**
   * Отказ входа НЕ проглатывается: обещание `onOpen` отклоняется, и движок по нему снимает сокет и
   * запускает переподключение (`handleDisruption`) — то есть новую попытку входа. Проверки живости
   * при этом не начинаются: движок заводит их только после того, как `onOpen` разрешится, — слать их
   * в сокет, который биржа не признала, не за чем, а `isConnected()` до восстановления честно
   * отвечает «нет».
   */
  private async authenticate(context: WebSocketOpenContext<OkxWebSocketMessage>): Promise<void> {
    try {
      await authenticateOkxWebSocket({
        context,
        apiKey: this.apiKey,
        secret: this.secret,
        passphrase: this.passphrase,
        label: this.label,
        logger: this.logger,
      });
    } catch (error) {
      this.logger.error(`${this.label}: login failed on open — the socket is not usable: ${error instanceof Error ? error.message : String(error)}`);

      throw error;
    }

    if (this.subscriptionArgList.length > 0) {
      this.refusedSubscriptionLabelSet.clear();
      context.send({ op: 'subscribe', args: this.subscriptionArgList });
    }
  }

  /**
   * Предупреждение о плановом разрыве (код 64008) биржа шлёт за минуту до него и прямо просит
   * переподключиться. Раньше оно ложилось в журнал предупреждением и ничего не меняло: мы дожидались
   * жёсткого обрыва, а канал заявок и позиций снимка при подписке не даёт — всё, что случится в окне
   * разрыва, до потребителя не доедет никогда. Теперь соединение переоткрывается заранее.
   */
  private handleServerNotice(message: OkxWebSocketMessage): void {
    if (message.code !== OKX_SERVICE_UPGRADE_NOTICE_CODE) {
      this.logger.warn(`${this.label}: server notice (${message.code ?? ''}) ${message.msg ?? ''}`);

      return;
    }

    this.logger.info(`${this.label}: server notice (${message.code}) ${message.msg ?? ''} — reconnecting ahead of the planned disconnect`);
    this.close();
    this.connect();
  }

  private handleMessage(message: OkxWebSocketMessage): void {
    if (message.event === 'subscribe') {
      this.logger.debug(`${this.label}: subscribed to ${JSON.stringify(message.arg)}`);

      return;
    }

    if (message.event === 'pong' || message.event === 'login') {
      return;
    }

    if (message.event === 'error') {
      if (message.arg !== undefined) {
        this.forgetRefusedSubscription(message.arg);
      }

      this.logger.error({ code: message.code, msg: message.msg, arg: message.arg }, `${this.label}: server error`);

      return;
    }

    if (message.event === 'notice') {
      this.handleServerNotice(message);

      return;
    }

    if (message.event === 'channel-conn-count-error') {
      this.logger.error({ frame: message }, `${this.label}: channel connection count exceeded`);

      return;
    }

    if (message.event !== undefined) {
      this.logger.warn({ frame: message }, `${this.label}: unhandled service frame`);

      return;
    }

    if (message.arg === undefined || message.data === undefined) {
      return;
    }

    try {
      this.onMessageHandler(message);
    } catch (error) {
      this.logger.error(`${this.label}: error handling message: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export { OkxPrivateStream };
