import { TASK_JOB_NAME, TASK_QUEUE_NAME } from '../infra/constants.js';
import { createQueueJobEnvelope } from '../queue/types.js';
import { getTaskQueueDriver } from './taskQueue.js';
import { taskStore } from './taskStore.js';
import type { WorkerTaskRecord } from './types.js';
import { utcNow } from './types.js';

export async function enqueueTaskRecord(
  record: WorkerTaskRecord,
  options: {
    stage: 'enqueue' | 'republish' | 'followup';
    eventMessage: string;
    delaySeconds?: number;
  },
): Promise<void> {
  const driver = await getTaskQueueDriver();
  await driver.enqueue(
    TASK_QUEUE_NAME,
    createQueueJobEnvelope(
      TASK_QUEUE_NAME,
      TASK_JOB_NAME,
      { taskId: record.taskId },
      {
        maxAttempts: record.maxAttempts,
        backoff: record.backoffSeconds,
        timeout: record.timeoutSeconds,
      },
    ),
    options.delaySeconds || 0,
  );

  await taskStore.save({
    ...record,
    queuePublishStatus: 'published',
    queuePublishedAt: utcNow(),
    queuePublishError: null,
    updatedAt: utcNow(),
  });
  await taskStore.appendEvent({
    taskId: record.taskId,
    eventType: 'enqueued',
    attemptNo: record.currentAttempt || null,
    workerName: record.workerName,
    message: options.eventMessage,
    detailJson: {
      queueName: TASK_QUEUE_NAME,
      stage: options.stage,
      delaySeconds: options.delaySeconds || 0,
    },
  });
}
