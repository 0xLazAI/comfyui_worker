import { PLATFORM_API_BASE, PLATFORM_API_ENABLED, PLATFORM_API_KEY, PLATFORM_BEARER_TOKEN } from '../infra/constants.js';

interface ApiEnvelope<T> {
  ok: boolean;
  data: T | null;
  meta?: Record<string, unknown>;
  error?: {
    code?: string;
    message?: string;
    details?: Record<string, unknown>;
  } | null;
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
  last_seen_at?: string | null;
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
      op: 'add' | 'replace' | 'remove';
      path: string;
      value?: unknown;
    }>;
  }>;
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
    heartbeat?: Record<string, unknown>;
    descriptionMd?: string;
  }): Promise<WorkerRegistrationResponse> {
    return this.requestJson('/api/workers/register', {
      method: 'POST',
      body: {
        worker_name: input.workerName,
        schema: input.schema,
        credentials: input.credentials,
        heartbeat: input.heartbeat,
        description_md: input.descriptionMd,
      },
    });
  }

  async registerNamedWorker(
    workerName: string,
    input: {
      schema: Record<string, unknown>;
      credentials: Record<string, unknown>;
      heartbeat?: Record<string, unknown>;
      descriptionMd?: string;
    },
  ): Promise<WorkerRegistrationResponse> {
    return this.requestJson(`/api/workers/${encodeURIComponent(workerName)}/registration`, {
      method: 'PUT',
      body: {
        schema: input.schema,
        credentials: input.credentials,
        heartbeat: input.heartbeat,
        description_md: input.descriptionMd,
      },
    });
  }

  async heartbeatWorker(
    workerName: string,
    heartbeat: {
      heartbeat_at?: string;
      status?: string;
      message?: string;
    },
  ): Promise<WorkerHeartbeatResponse> {
    return this.requestJson(`/api/workers/${encodeURIComponent(workerName)}/heartbeat`, {
      method: 'POST',
      body: heartbeat,
    });
  }

  async readPaceFiles(projectId: string, paths: string[]): Promise<PaceFilesReadResponse> {
    const query = new URLSearchParams();
    for (const path of paths) {
      query.append('path', path);
    }
    return this.requestJson(`/api/${encodeURIComponent(projectId)}/pace/files?${query.toString()}`, {
      method: 'GET',
    });
  }

  async readPaceFile(projectId: string, path: string): Promise<PaceFileResponse> {
    const response = await this.readPaceFiles(projectId, [path]);
    const file = response.files[0];
    if (!file) {
      throw new PaiPlatformApiError(`PACE file was not returned: ${path}`, 502, 'pace_file_missing', {
        projectId,
        path,
      });
    }
    return file;
  }

  async writePaceFiles(projectId: string, input: PaceWriteBatchInput): Promise<PaceFilesBatchResponse> {
    return this.requestJson(`/api/${encodeURIComponent(projectId)}/pace/files`, {
      method: 'POST',
      body: {
        writes: input.writes || [],
        patches: input.patches || [],
      },
    });
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

    const envelope = await this.parseEnvelope<unknown>(response);
    throw new PaiPlatformApiError(
      envelope.error?.message || `Pai Platform assets URL request failed with HTTP ${response.status}`,
      response.status,
      envelope.error?.code || 'assets_url_failed',
      envelope.error?.details || {
        projectId,
        assetUri,
      },
    );
  }

  private async requestJson<T>(path: string, input: {
    method: 'GET' | 'POST' | 'PUT';
    body?: unknown;
  }): Promise<T> {
    this.ensureEnabled();
    const response = await fetch(this.buildUrl(path), {
      method: input.method,
      headers: this.buildHeaders({
        'content-type': 'application/json',
      }),
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
    });
    const envelope = await this.parseEnvelope<T>(response);
    if (!response.ok || !envelope.ok || envelope.data === null) {
      throw new PaiPlatformApiError(
        envelope.error?.message || `Pai Platform request failed with HTTP ${response.status}`,
        response.status,
        envelope.error?.code || 'pai_platform_request_failed',
        envelope.error?.details || {},
      );
    }
    return envelope.data;
  }

  private async parseEnvelope<T>(response: Response): Promise<ApiEnvelope<T>> {
    const text = await response.text();
    if (!text.trim()) {
      return {
        ok: false,
        data: null,
        error: {
          code: 'empty_platform_response',
          message: 'Pai Platform returned an empty response.',
          details: {},
        },
      };
    }

    try {
      return JSON.parse(text) as ApiEnvelope<T>;
    } catch {
      return {
        ok: false,
        data: null,
        error: {
          code: 'invalid_platform_response',
          message: 'Pai Platform returned non-JSON content.',
          details: {
            raw: text,
          },
        },
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
    const bearerToken = PLATFORM_BEARER_TOKEN || PLATFORM_API_KEY;
    if (bearerToken) {
      headers.authorization = `Bearer ${bearerToken}`;
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
