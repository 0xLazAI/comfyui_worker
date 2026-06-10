export class TaskRejectedError extends Error {
  code: string;

  constructor(message: string, code = 'task_rejected') {
    super(message);
    this.code = code;
  }
}

export class ProviderRequestError extends Error {
  code: string;
  statusCode: number;
  detail?: Record<string, unknown>;

  constructor(message: string, statusCode: number, code = 'provider_request_failed', detail?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.detail = detail;
  }
}
