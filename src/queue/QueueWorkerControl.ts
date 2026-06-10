export interface QueueWorkerControlSnapshot {
  restartTimestamp: number | null;
  pausedQueues: Set<string>;
}

export interface QueueWorkerControl {
  getSnapshot(queues: string[]): Promise<QueueWorkerControlSnapshot>;
}

export class NoopQueueWorkerControl implements QueueWorkerControl {
  async getSnapshot(_queues: string[]): Promise<QueueWorkerControlSnapshot> {
    return {
      restartTimestamp: null,
      pausedQueues: new Set<string>(),
    };
  }
}
