import type { ExchangeLogger } from '../types/common';
import type { OutboundCommandQueueArgs, OutboundCommandQueueSnapshot } from './OutboundCommandQueue.types';

const ONE_SECOND_MS = 1000;

class OutboundCommandQueue {
  private readonly label: string;
  private readonly logger: ExchangeLogger;
  private readonly maxCommandsPerSecond: number;
  private readonly intervalMs: number;
  private readonly send: (data: unknown) => void;
  private readonly onSendFailure: (error: unknown) => void;

  private readonly pendingCommandList: unknown[] = [];
  private readonly drainedResolveList: (() => void)[] = [];

  private sentCommandCount = 0;
  private clearedCommandCount = 0;
  private timerId?: NodeJS.Timeout;
  private isDisposed = false;

  constructor(args: OutboundCommandQueueArgs) {
    this.label = args.label;
    this.logger = args.logger;
    this.maxCommandsPerSecond = args.maxCommandsPerSecond;
    this.intervalMs = Math.ceil(ONE_SECOND_MS / args.maxCommandsPerSecond);
    this.send = args.send;
    this.onSendFailure = args.onSendFailure;
  }

  enqueue(command: unknown): void {
    if (this.isDisposed) {
      return;
    }

    this.pendingCommandList.push(command);
    this.scheduleDrain(0);
  }

  enqueueList(commandList: unknown[]): void {
    if (this.isDisposed || commandList.length === 0) {
      return;
    }

    this.pendingCommandList.push(...commandList);
    this.scheduleDrain(0);
  }

  awaitDrained(): Promise<void> {
    if (this.pendingCommandList.length === 0 && this.timerId === undefined) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.drainedResolveList.push(resolve);
    });
  }

  clear(reason: string): void {
    const droppedCount = this.pendingCommandList.length;

    this.pendingCommandList.length = 0;
    this.clearedCommandCount += droppedCount;

    if (this.timerId !== undefined) {
      clearTimeout(this.timerId);
      this.timerId = undefined;
    }

    if (droppedCount > 0) {
      this.logger.info(
        `OutboundCommandQueue: ${this.label} dropped ${droppedCount} pending command(s) — ${reason}`,
      );
    }

    this.resolveDrained();
  }

  dispose(): void {
    this.clear('queue disposed');
    this.isDisposed = true;
  }

  getSnapshot(): OutboundCommandQueueSnapshot {
    return {
      pendingCommandCount: this.pendingCommandList.length,
      sentCommandCount: this.sentCommandCount,
      clearedCommandCount: this.clearedCommandCount,
      maxCommandsPerSecond: this.maxCommandsPerSecond,
    };
  }

  private scheduleDrain(delayMs: number): void {
    if (this.timerId !== undefined || this.isDisposed) {
      return;
    }

    this.timerId = setTimeout(() => {
      this.timerId = undefined;
      this.drainOne();
    }, delayMs);

    this.timerId.unref?.();
  }

  private drainOne(): void {
    if (this.isDisposed) {
      return;
    }

    const command = this.pendingCommandList.shift();

    if (command === undefined) {
      this.resolveDrained();

      return;
    }

    try {
      this.send(command);
      this.sentCommandCount++;
    } catch (error) {
      this.clear(
        `send failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.onSendFailure(error);

      return;
    }

    if (this.pendingCommandList.length > 0) {
      this.scheduleDrain(this.intervalMs);

      return;
    }

    this.resolveDrained();
  }

  private resolveDrained(): void {
    if (this.drainedResolveList.length === 0) {
      return;
    }

    const resolveList = [...this.drainedResolveList];

    this.drainedResolveList.length = 0;
    resolveList.forEach((resolve) => resolve());
  }
}

export { OutboundCommandQueue };
