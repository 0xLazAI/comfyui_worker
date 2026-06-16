import { randomUUID } from 'crypto';
import cors from 'cors';
import express from 'express';
import rTracer from 'cls-rtracer';
import multer from 'multer';
import { errorHandler } from './infra/errorHandler.js';
import { currentRequestId } from './infra/logger.js';
import { UnauthorizedError, ValidationError, NotFoundError } from './infra/HttpError.js';
import { CONTRACT_VERSION, PLATFORM_API_ENABLED, WORKER_NODE_TYPE, WORKER_TOKEN, WORKER_VERSION } from './infra/constants.js';
import { WorkerRegistryPublisher } from './registry/WorkerRegistryPublisher.js';
import { normalizeTaskDefinitionJson } from './taskDefinitions/definitionSchema.js';
import { taskTypeDefinitionStore } from './taskDefinitions/taskTypeDefinitionStore.js';
import { supportsConsumerKey } from './tasks/taskExecution.js';
import { getTaskResponse, submitTask } from './tasks/taskService.js';

function parseObjectBody(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function parsePayloadBody(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null || value === '') {
    return {};
  }
  if (typeof value === 'string') {
    try {
      return parseObjectBody(JSON.parse(value), 'payload');
    } catch {
      throw new ValidationError('payload must be valid JSON when sent as string');
    }
  }
  return parseObjectBody(value, 'payload');
}

function requireString(value: unknown, field: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new ValidationError(`${field} is required`);
  }
  return normalized;
}

function optionalString(value: unknown): string | undefined {
  const normalized = String(value || '').trim();
  return normalized || undefined;
}

function requireInteger(value: unknown, field: string): number {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 1) {
    throw new ValidationError(`${field} must be an integer >= 1`);
  }
  return Math.floor(normalized);
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true') {
    return true;
  }
  if (normalized === 'false') {
    return false;
  }
  throw new ValidationError('enabled must be a boolean');
}

function requestActor(req: express.Request): string {
  return optionalString(req.header('x-operator') || req.header('x-actor') || req.header('x-user')) || 'system';
}

function requireBearer(authorization: string | undefined): void {
  const expected = `Bearer ${WORKER_TOKEN}`;
  if (authorization !== expected) {
    throw new UnauthorizedError();
  }
}

const registryPublisher = new WorkerRegistryPublisher();

export function createApp(): express.Express {
  const app = express();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 20 * 1024 * 1024,
      files: 1,
    },
  });
  const tracer = (rTracer as any).expressMiddleware({
    useHeader: true,
    headerName: 'x-request-id',
    echoHeader: true,
    requestIdFactory: () => randomUUID(),
  });

  app.use(tracer);
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/capabilities', async (req, res) => {
    const supportedTasks = await taskTypeDefinitionStore.listEnabledTaskTypes();
    res.json({
      node_type: WORKER_NODE_TYPE,
      version: WORKER_VERSION,
      contract_version: CONTRACT_VERSION,
      supported_tasks: supportedTasks,
      can_write_project_files: !PLATFORM_API_ENABLED,
      can_write_pace_files: PLATFORM_API_ENABLED,
      requires_project_mount: !PLATFORM_API_ENABLED,
      supported_asset_kinds: PLATFORM_API_ENABLED ? ['renders', 'uploads', 'storyboard'] : ['renders', 'uploads'],
    });
  });

  app.post('/tasks', upload.fields([
    { name: 'source_image', maxCount: 1 },
    { name: 'image', maxCount: 1 },
  ]), async (req, res) => {
    const body = parseObjectBody(req.body, 'body');
    const payload = parsePayloadBody(body.payload);
    const sourceImageUpload = extractSourceImageUpload(req);
    const response = await submitTask({
      taskId: requireString(body.task_id, 'task_id'),
      taskType: requireString(body.task_type, 'task_type'),
      projectId: requireString(body.project_id, 'project_id'),
      projectRoot: requireString(body.project_root, 'project_root'),
      payload,
      sourceImageUpload,
      requestId: currentRequestId() ?? null,
      dedupeKey: optionalString(req.header('x-idempotency-key') || req.header('idempotency-key')),
    });
    res.json(response);
  });

  app.get('/tasks/:taskId', async (req, res) => {
    const task = await getTaskResponse(String(req.params.taskId || '').trim());
    if (!task) {
      throw new NotFoundError('Task not found');
    }
    res.json(task);
  });

  app.get('/task-definitions', async (req, res) => {
    requireBearer(req.header('authorization') || undefined);
    const workerName = optionalString(req.query.worker_name);
    const taskType = optionalString(req.query.task_type);
    const enabled = optionalBoolean(req.query.enabled);
    const definitions = await taskTypeDefinitionStore.list({
      workerName,
      taskType,
      enabled,
    });
    res.json({ items: definitions });
  });

  app.get('/task-definitions/:id', async (req, res) => {
    requireBearer(req.header('authorization') || undefined);
    const definition = await taskTypeDefinitionStore.getById(requireString(req.params.id, 'id'));
    if (!definition) {
      throw new NotFoundError('Task definition not found');
    }
    res.json(definition);
  });

  app.post('/task-definitions', async (req, res) => {
    requireBearer(req.header('authorization') || undefined);
    const body = parseObjectBody(req.body, 'body');
    const definitionJson = normalizeTaskDefinitionJson(parseObjectBody(body.definition_json, 'definition_json'));
    if (!supportsConsumerKey(definitionJson.consumer_key)) {
      throw new ValidationError(`unsupported consumer_key: ${definitionJson.consumer_key}`);
    }
    const definition = await taskTypeDefinitionStore.create({
      workerName: requireString(body.worker_name, 'worker_name'),
      taskType: requireString(body.task_type, 'task_type'),
      version: requireInteger(body.version, 'version'),
      enabled: optionalBoolean(body.enabled) ?? false,
      description: optionalString(body.description) ?? null,
      definitionJson,
      actor: requestActor(req),
    });
    await registryPublisher.syncWorker(definition.workerName);
    res.status(201).json(definition);
  });

  app.put('/task-definitions/:id', async (req, res) => {
    requireBearer(req.header('authorization') || undefined);
    const body = parseObjectBody(req.body, 'body');
    const definitionJson = body.definition_json === undefined
      ? undefined
      : normalizeTaskDefinitionJson(parseObjectBody(body.definition_json, 'definition_json'));
    if (definitionJson && !supportsConsumerKey(definitionJson.consumer_key)) {
      throw new ValidationError(`unsupported consumer_key: ${definitionJson.consumer_key}`);
    }
    const existing = await taskTypeDefinitionStore.getById(requireString(req.params.id, 'id'));
    if (!existing) {
      throw new NotFoundError('Task definition not found');
    }
    const definition = await taskTypeDefinitionStore.update(requireString(req.params.id, 'id'), {
      workerName: body.worker_name === undefined ? undefined : requireString(body.worker_name, 'worker_name'),
      taskType: body.task_type === undefined ? undefined : requireString(body.task_type, 'task_type'),
      version: body.version === undefined ? undefined : requireInteger(body.version, 'version'),
      enabled: optionalBoolean(body.enabled),
      description: body.description === undefined ? undefined : (optionalString(body.description) ?? null),
      definitionJson,
      actor: requestActor(req),
    });
    await registryPublisher.syncWorker(existing.workerName);
    if (definition.workerName !== existing.workerName) {
      await registryPublisher.syncWorker(definition.workerName);
    }
    res.json(definition);
  });

  app.delete('/task-definitions/:id', async (req, res) => {
    requireBearer(req.header('authorization') || undefined);
    const definition = await taskTypeDefinitionStore.getById(requireString(req.params.id, 'id'));
    if (!definition) {
      throw new NotFoundError('Task definition not found');
    }
    const deleted = await taskTypeDefinitionStore.delete(requireString(req.params.id, 'id'));
    if (!deleted) {
      throw new NotFoundError('Task definition not found');
    }
    await registryPublisher.syncWorker(definition.workerName);
    res.json({ deleted: true });
  });

  app.use(errorHandler);
  return app;
}

function extractSourceImageUpload(req: express.Request): {
  buffer: Buffer;
  contentType?: string | null;
  filename?: string | null;
} | null {
  const files = req.files as Record<string, Express.Multer.File[]> | undefined;
  const file = files?.source_image?.[0] || files?.image?.[0] || null;
  if (!file) {
    return null;
  }

  const contentType = String(file.mimetype || '').trim().toLowerCase();
  const filename = String(file.originalname || '').trim();
  if (contentType && !contentType.startsWith('image/')) {
    throw new ValidationError('source_image must be an image file');
  }

  return {
    buffer: file.buffer,
    contentType: contentType || null,
    filename: filename || null,
  };
}
