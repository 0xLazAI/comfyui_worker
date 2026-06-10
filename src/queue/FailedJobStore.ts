import type { FailedJobRecord } from './types.js';

export interface FailedJobStore {
  save(record: FailedJobRecord): Promise<void>;
}

export class NoopFailedJobStore implements FailedJobStore {
  async save(_record: FailedJobRecord): Promise<void> {}
}
