import type { ExchangeLogger } from '../types/common';
import type { OkxConnectionOperationBudgetArgs } from './OkxConnectionOperationBudget.types';

/**
 * Учёт документированного предела биржи: «The total number of 'subscribe'/'unsubscribe'/'login'
 * requests per connection is limited to 480 times per hour». Считается ОДНА отправленная команда,
 * а не тема в ней: пачка из пятидесяти тем — это один запрос подписки.
 *
 * Без учёта предел выбирался молча: сторож подписок снаружи чинит подозрительные символы парой
 * «снять + поставить», и достаточно нескольких десятков починок в час, чтобы биржа перестала
 * принимать подписки на этом соединении — а узнали бы мы об этом только по отсутствию данных.
 * Превышение — отказ отправки с записью в журнал, а не исключение: потерять кадр подписки не так
 * страшно, как уронить поток; вызывающий на отказ пересоздаёт соединение, и у нового соединения
 * бюджет свой.
 */
class OkxConnectionOperationBudget {
  private readonly label: string;
  private readonly logger: ExchangeLogger;
  private readonly limitPerWindow: number;
  private readonly windowMs: number;
  private readonly warnThreshold: number;
  private readonly operationTimestampList: number[] = [];
  private hasWarnedNearLimit = false;

  constructor(args: OkxConnectionOperationBudgetArgs) {
    this.label = args.label;
    this.logger = args.logger;
    this.limitPerWindow = args.limitPerWindow;
    this.windowMs = args.windowMs;
    this.warnThreshold = Math.floor(args.limitPerWindow * args.warnRatio);
  }

  registerOperation(operationName: string): boolean {
    const now = Date.now();
    this.forgetOperationsOutsideWindow(now);

    if (this.operationTimestampList.length >= this.limitPerWindow) {
      this.logger.error(
        `OkxConnectionOperationBudget: ${this.label} refuses '${operationName}' — ${this.limitPerWindow} subscribe/unsubscribe operations already spent within the last hour`,
      );

      return false;
    }

    this.operationTimestampList.push(now);

    if (this.operationTimestampList.length < this.warnThreshold) {
      this.hasWarnedNearLimit = false;

      return true;
    }

    if (!this.hasWarnedNearLimit) {
      this.hasWarnedNearLimit = true;
      this.logger.warn(
        `OkxConnectionOperationBudget: ${this.label} spent ${this.operationTimestampList.length}/${this.limitPerWindow} subscribe/unsubscribe operations this hour`,
      );
    }

    return true;
  }

  getUsedOperationCount(): number {
    this.forgetOperationsOutsideWindow(Date.now());

    return this.operationTimestampList.length;
  }

  private forgetOperationsOutsideWindow(now: number): void {
    const windowStart = now - this.windowMs;
    let outsideCount = 0;

    while (outsideCount < this.operationTimestampList.length && this.operationTimestampList[outsideCount] <= windowStart) {
      outsideCount++;
    }

    if (outsideCount > 0) {
      this.operationTimestampList.splice(0, outsideCount);
    }
  }
}

export { OkxConnectionOperationBudget };
