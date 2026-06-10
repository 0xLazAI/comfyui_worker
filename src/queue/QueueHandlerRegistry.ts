import type { QueueHandler } from './types.js';

interface QueueHandlerEntry {
  handler: QueueHandler;
  handlerLabel: string;
}

export class QueueHandlerRegistry {
  private handlers = new Map<string, QueueHandlerEntry>();

  register(queue: string, jobName: string, handler: QueueHandler, handlerLabel?: string): this {
    this.handlers.set(this.buildKey(queue, jobName), {
      handler,
      handlerLabel: handlerLabel || handler.name || jobName,
    });
    return this;
  }

  resolve(queue: string, jobName: string): QueueHandlerEntry | null {
    return this.handlers.get(this.buildKey(queue, jobName))
      || this.handlers.get(this.buildKey('*', jobName))
      || null;
  }

  private buildKey(queue: string, jobName: string): string {
    return `${String(queue || '').trim()}:${String(jobName || '').trim()}`;
  }
}
