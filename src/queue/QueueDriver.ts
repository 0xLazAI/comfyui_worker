import type { QueueJobEnvelope, ReservedJob } from './types.js';

export interface QueueSize {
  ready: number;
  delayed: number;
  reserved: number;
}

export interface QueueDriver {
  enqueue(queue: string, payload: QueueJobEnvelope, delaySeconds?: number): Promise<void>;
  reserve(queue: string): Promise<ReservedJob | null>;
  ack(queue: string, reservedPayload: string): Promise<void>;
  release(queue: string, reservedPayload: string, payload: QueueJobEnvelope, delaySeconds: number): Promise<void>;
  migrate(queue: string): Promise<void>;
  clear(queue: string): Promise<void>;
  size(queue: string): Promise<QueueSize>;
  waitForNotify(queue: string, blockForSeconds: number): Promise<boolean>;
  close?(): Promise<void>;
}
