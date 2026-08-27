import { BASE_URL, PLATFORM_API_BASE, PLATFORM_API_ENABLED, PLATFORM_API_KEY } from '../infra/constants.js';

interface GraphqlResponse<T> {
  data?: T | null;
  errors?: Array<{
    message?: string;
    path?: Array<string | number>;
    extensions?: Record<string, unknown>;
  }>;
}

interface PaceFileResponse {
  project: string;
  path: string;
  kind: string;
  format: string;
  size_bytes: number;
  updated_at?: string | null;
  value: unknown;
}

interface PaceFilesReadResponse {
  project: string;
  files: PaceFileResponse[];
}

interface PaceFilesBatchResponse {
  project: string;
  changed: Array<{
    path: string;
    kind: string;
    format: string;
  }>;
  validation: {
    ok: boolean;
    issues: Array<Record<string, unknown>>;
  };
}

interface WorkerRegistrationResponse {
  name: string;
  status: string;
  worker?: Record<string, unknown> | null;
}

interface WorkerHeartbeatResponse {
  name: string;
  status: string;
  lastSeenAt?: string | null;
  worker?: Record<string, unknown> | null;
}

export interface PaceWriteBatchInput {
  writes?: Array<{
    path: string;
    value: unknown;
  }>;
  patches?: Array<{
    path: string;
    operations: Array<{
      op: 'ADD' | 'REPLACE' | 'REMOVE' | 'add' | 'replace' | 'remove';
      path: string;
      value?: unknown;
    }>;
  }>;
}

type PacePatch = NonNullable<PaceWriteBatchInput['patches']>[number];
type PacePatchOperation = PacePatch['operations'][number];

export interface AssetUploadUrlResponse {
  assetsUri: string;
  uploadUrl: string;
  method?: string;
  headers: Record<string, string>;
  expiresIn: number;
}

export class PaiPlatformApiError extends Error {
  statusCode: number;
  code: string;
  details: Record<string, unknown>;

  constructor(message: string, statusCode: number, code = 'pai_platform_request_failed', details: Record<string, unknown> = {}) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

class PaiPlatformClient {
  isEnabled(): boolean {
    return PLATFORM_API_ENABLED;
  }

  async registerWorker(input: {
    workerName?: string;
    schema: Record<string, unknown>;
    credentials: Record<string, unknown>;
    descriptionMd?: string;
    maxConcurrent?: number;
  }): Promise<WorkerRegistrationResponse> {
    const workerName = input.workerName || String(input.schema.name || '').trim();
    const description = input.descriptionMd || String(input.schema.description || '').trim();
    try {
      const data = await this.requestGraphql<{
        registerWorker: WorkerRegistrationResponse;
      }>(`
        mutation RegisterWorker($input: WorkerRegistrationInput!) {
          registerWorker(input: $input) {
            name
            status
          }
        }
      `, {
        input: {
          workerName,
          schema: input.schema,
          credentials: input.credentials,
          heartbeat: {
            heartbeatAt: new Date().toISOString(),
            status: 'online',
            message: 'idle',
          },
          descriptionMd: description,
        },
      });
      return data.registerWorker;
    } catch (error) {
      if (!isGraphqlSchemaMismatch(error)) {
        throw error;
      }
      const data = await this.requestGraphql<{
        registerWorker: WorkerRegistrationResponse;
      }>(`
        mutation RegisterWorker($input: WorkerRegistrationInput!) {
          registerWorker(input: $input) {
            name
            status
          }
        }
      `, {
        input: {
          name: workerName,
          baseUrl: BASE_URL,
          description,
          schema: input.schema,
          credentials: input.credentials,
          maxConcurrent: input.maxConcurrent || 1,
        },
      });
      return data.registerWorker;
    }
  }

  async registerNamedWorker(
    workerName: string,
    input: {
      schema: Record<string, unknown>;
      credentials: Record<string, unknown>;
      descriptionMd?: string;
      maxConcurrent?: number;
    },
  ): Promise<WorkerRegistrationResponse> {
    return this.registerWorker({
      workerName,
      schema: input.schema,
      credentials: input.credentials,
      descriptionMd: input.descriptionMd,
      maxConcurrent: input.maxConcurrent,
    });
  }

  async heartbeatWorker(
    workerName: string,
    heartbeat: {
      status?: string;
      capacity?: {
        running: number;
        maxConcurrent: number;
      };
    },
  ): Promise<WorkerHeartbeatResponse> {
    const capacity = heartbeat.capacity || {
      running: 0,
      maxConcurrent: 1,
    };
    try {
      const data = await this.requestGraphql<{
        heartbeatWorker: WorkerHeartbeatResponse;
      }>(`
        mutation HeartbeatWorker($workerName: String!, $input: WorkerHeartbeatInput!) {
          heartbeatWorker(workerName: $workerName, input: $input) {
            name
            status
            lastSeenAt
          }
        }
      `, {
        workerName,
        input: {
          heartbeatAt: new Date().toISOString(),
          status: heartbeat.status || 'online',
          message: 'idle',
          extra: {
            capacity,
          },
        },
      });
      return data.heartbeatWorker;
    } catch (error) {
      if (!isGraphqlSchemaMismatch(error)) {
        throw error;
      }
      const data = await this.requestGraphql<{
        heartbeatWorker: WorkerHeartbeatResponse;
      }>(`
        mutation HeartbeatWorker($name: String!, $input: WorkerHeartbeatInput!) {
          heartbeatWorker(name: $name, input: $input) {
            name
            status
            lastSeenAt
          }
        }
      `, {
        name: workerName,
        input: {
          status: heartbeat.status || 'online',
          capacity,
        },
      });
      return data.heartbeatWorker;
    }
  }

  async readPaceFiles(projectId: string, paths: string[]): Promise<PaceFilesReadResponse> {
    const files = await Promise.all(paths.map((path) => this.readPaceFile(projectId, path)));
    return {
      project: projectId,
      files,
    };
  }

  async readPaceFile(projectId: string, path: string): Promise<PaceFileResponse> {
    const data = await this.requestGraphql<{
      paceFile: PaceFileResponse | null;
    }>(`
      query ReadPaceFile($projectId: String!, $path: String!) {
        paceFile(projectId: $projectId, path: $path) {
          path
          kind
          format
          sizeBytes
          updatedAt
          value
        }
      }
    `, {
      projectId,
      path,
    });
    const file = data.paceFile;
    if (!file) {
      throw new PaiPlatformApiError(`PACE file was not returned: ${path}`, 404, 'pace_file_missing', {
        projectId,
        path,
      });
    }
    return file;
  }

  async writePaceFiles(projectId: string, input: PaceWriteBatchInput): Promise<PaceFilesBatchResponse> {
    const data = await this.requestGraphql<{
      writePaceFiles: PaceFilesBatchResponse;
    }>(`
      mutation WritePaceFiles(
        $projectId: String!
        $writes: [PaceFileWriteInput!]
        $patches: [PaceFilePatchInput!]
      ) {
        writePaceFiles(projectId: $projectId, writes: $writes, patches: $patches) {
          changed { path kind format }
          validation {
            ok
            issues {
              code
              path
              field
              schemaPath
              message
            }
          }
        }
      }
    `, {
      projectId,
      writes: input.writes || [],
      patches: normalizePacePatches(input.patches || []),
    });
    return data.writePaceFiles;
  }

  async deletePaceFiles(projectId: string, paths: string[]): Promise<{
    deleted: Array<{ path: string; type: string }>;
    recycled: Array<{ path: string; recycledPath: string }>;
  }> {
    const data = await this.requestGraphql<{
      deletePaceFiles: {
        deleted: Array<{ path: string; type: string }>;
        recycled: Array<{ path: string; recycledPath: string }>;
      };
    }>(`
      mutation DeletePaceFiles($projectId: String!, $paths: [String!]!) {
        deletePaceFiles(projectId: $projectId, paths: $paths) {
          deleted { path type }
          recycled { path recycledPath }
        }
      }
    `, {
      projectId,
      paths,
    });
    return data.deletePaceFiles;
  }

  async readPaceProjectRevision(projectId: string): Promise<string> {
    const data = await this.requestGraphql<{ paceProjectRevision: string }>(`
      query PaceProjectRevision($projectId: String!) {
        paceProjectRevision(projectId: $projectId)
      }
    `, { projectId });
    return data.paceProjectRevision;
  }

  async measureEntityDimensions(input: {
    projectId: string;
    entityKind: 'character' | 'prop' | 'location';
    entityId: string;
    expectedRevision: string;
    versionId: string;
    contentHash: string;
    initializeSupportAnchors?: boolean;
  }): Promise<{
    snapshotRevision: string;
    changedPaths: string[];
    affectedShotIds: string[];
    payload: Record<string, unknown>;
  }> {
    const data = await this.requestGraphql<{
      measureEntityDimensions: {
        snapshotRevision: string;
        changedPaths: string[];
        affectedShotIds: string[];
        payload: Record<string, unknown>;
      };
    }>(`
      mutation MeasureEntityDimensions($input: EntityDimensionMeasureInput!) {
        measureEntityDimensions(input: $input) {
          snapshotRevision
          changedPaths
          affectedShotIds
          payload
        }
      }
    `, { input });
    return data.measureEntityDimensions;
  }

  async createAssetUploadUrl(input: {
    projectId: string;
    assetKind: string;
    contentType: string;
    contentHash?: string;
  }): Promise<AssetUploadUrlResponse> {
    try {
      const data = await this.requestGraphql<{
        createAssetUploadUrl: AssetUploadUrlResponse;
      }>(`
        mutation CreateAssetUploadUrl($projectId: String!, $assetKind: AssetKind!, $contentType: String!, $contentHash: String) {
          createAssetUploadUrl(projectId: $projectId, assetKind: $assetKind, contentType: $contentType, contentHash: $contentHash) {
            assetsUri
            uploadUrl
            headers
            expiresIn
          }
        }
      `, {
        projectId: input.projectId,
        assetKind: input.assetKind,
        contentType: input.contentType,
        contentHash: input.contentHash,
      });
      return data.createAssetUploadUrl;
    } catch (error) {
      if (!isGraphqlSchemaMismatch(error)) {
        throw error;
      }
      const data = await this.requestGraphql<{
        createAssetUploadUrl: AssetUploadUrlResponse;
      }>(`
        mutation CreateAssetUploadUrl($input: AssetUploadUrlInput!) {
          createAssetUploadUrl(input: $input) {
            assetsUri
            uploadUrl
            method
            headers
            expiresIn
          }
        }
      `, {
        input: {
          projectId: input.projectId,
          assetKind: input.assetKind,
          contentType: input.contentType,
        },
      });
      return data.createAssetUploadUrl;
    }
  }

  async resolveAssetDownloadUrl(projectId: string, assetUri: string): Promise<string> {
    this.ensureEnabled();
    const response = await fetch(
      this.buildUrl(`/api/${encodeURIComponent(projectId)}/assets/url?assets_uri=${encodeURIComponent(assetUri)}`),
      {
        method: 'GET',
        headers: this.buildHeaders(),
        redirect: 'manual',
      },
    );

    if (response.status >= 300 && response.status < 400) {
      const redirectUrl = response.headers.get('location');
      if (!redirectUrl) {
        throw new PaiPlatformApiError('Pai Platform assets redirect did not include location header.', response.status, 'assets_url_missing_location', {
          projectId,
          assetUri,
        });
      }
      return redirectUrl;
    }

    const text = await response.text().catch(() => '');
    throw new PaiPlatformApiError(
      extractRestErrorMessage(text) || `Pai Platform assets URL request failed with HTTP ${response.status}`,
      response.status,
      'assets_url_failed',
      {
        projectId,
        assetUri,
        raw: text,
      },
    );
  }

  private async requestGraphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    this.ensureEnabled();
    const response = await fetch(this.buildUrl('/api/graphql/'), {
      method: 'POST',
      headers: this.buildHeaders({
        'content-type': 'application/json',
      }),
      body: JSON.stringify({
        query,
        variables,
      }),
    });
    const payload = await this.parseGraphqlResponse<T>(response);
    const firstError = payload.errors?.[0];
    if (!response.ok || firstError || payload.data === undefined || payload.data === null) {
      throw new PaiPlatformApiError(
        firstError?.message || `Pai Platform GraphQL request failed with HTTP ${response.status}`,
        response.status,
        String(firstError?.extensions?.code || 'pai_platform_graphql_failed'),
        {
          errors: payload.errors || [],
        },
      );
    }
    return payload.data;
  }

  private async parseGraphqlResponse<T>(response: Response): Promise<GraphqlResponse<T>> {
    const text = await response.text();
    if (!text.trim()) {
      return {
        data: null,
        errors: [{ message: 'Pai Platform returned an empty GraphQL response.' }],
      };
    }

    try {
      return JSON.parse(text) as GraphqlResponse<T>;
    } catch {
      return {
        data: null,
        errors: [{ message: 'Pai Platform returned a non-JSON GraphQL response.' }],
      };
    }
  }

  private buildUrl(path: string): string {
    this.ensureEnabled();
    return new URL(path, PLATFORM_API_BASE).toString();
  }

  private buildHeaders(extra: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = { ...extra };
    if (PLATFORM_API_KEY) {
      headers['x-api-key'] = PLATFORM_API_KEY;
    }
    return headers;
  }

  private ensureEnabled(): void {
    if (!PLATFORM_API_ENABLED || !PLATFORM_API_BASE) {
      throw new PaiPlatformApiError('PAI platform API is not configured.', 500, 'pai_platform_not_configured');
    }
  }
}

export const paiPlatformClient = new PaiPlatformClient();

function extractRestErrorMessage(text: string): string {
  if (!text.trim()) {
    return '';
  }
  try {
    const parsed = JSON.parse(text) as {
      error?: {
        message?: string;
      };
      message?: string;
    };
    return String(parsed.error?.message || parsed.message || '').trim();
  } catch {
    return text.slice(0, 240);
  }
}

function isGraphqlSchemaMismatch(error: unknown): boolean {
  if (!(error instanceof PaiPlatformApiError)) {
    return false;
  }
  const messages = extractGraphqlErrorMessages(error.details).join('\n');
  return /Unknown argument|Unknown field|Cannot query field|Field .* is not defined|got invalid value|was not provided|required field/i.test(messages);
}

function extractGraphqlErrorMessages(details: Record<string, unknown>): string[] {
  const errors = details.errors;
  if (!Array.isArray(errors)) {
    return [];
  }
  return errors.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return '';
    }
    return String((entry as Record<string, unknown>).message || '').trim();
  }).filter(Boolean);
}

function normalizePacePatches(patches: PaceWriteBatchInput['patches']): PaceWriteBatchInput['patches'] {
  return (patches || []).map((patch) => ({
    ...patch,
    operations: patch.operations.map((operation) => ({
      ...operation,
      op: normalizePatchOp(operation.op),
    })),
  }));
}

function normalizePatchOp(op: PacePatchOperation['op']): 'ADD' | 'REPLACE' | 'REMOVE' {
  const normalized = String(op || '').trim().toUpperCase();
  if (normalized === 'ADD' || normalized === 'REPLACE' || normalized === 'REMOVE') {
    return normalized;
  }
  throw new PaiPlatformApiError(`Unsupported PACE patch op: ${op}`, 500, 'unsupported_pace_patch_op');
}
