import { randomBytes } from 'crypto';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  PAI_ASSET_ACCESS_KEY_ID,
  PAI_ASSET_BUCKET,
  PAI_ASSET_ENDPOINT,
  PAI_ASSET_PREFIX_TEMPLATE,
  PAI_ASSET_REGION,
  PAI_ASSET_SECRET_ACCESS_KEY,
} from '../infra/constants.js';

export interface DownloadedAsset {
  assetUri: string;
  buffer: Buffer;
  contentType: string;
  filename: string;
}

export interface UploadedAsset {
  assetUri: string;
  filename: string;
  bytes: number;
  contentType: string;
}

let client: S3Client | null = null;

export async function downloadAsset(projectId: string, assetUri: string): Promise<DownloadedAsset> {
  const normalizedUri = normalizeAssetUri(assetUri);
  const key = buildObjectKey(projectId, normalizedUri);
  const result = await getS3Client().send(new GetObjectCommand({
    Bucket: PAI_ASSET_BUCKET,
    Key: key,
  }));
  const body = result.Body;
  if (!body || typeof body.transformToByteArray !== 'function') {
    throw new Error(`asset download returned no body for ${assetUri}`);
  }
  const bytes = await body.transformToByteArray();
  return {
    assetUri: normalizedUri,
    buffer: Buffer.from(bytes),
    contentType: String(result.ContentType || guessContentTypeFromFilename(normalizedUri)),
    filename: normalizedUri.slice('assets://'.length).split('/').pop() || 'asset.bin',
  };
}

export async function uploadRenderAsset(
  projectId: string,
  input: {
    buffer: Buffer;
    contentType?: string;
    filenameHint?: string;
  },
): Promise<UploadedAsset> {
  return uploadWorkerAsset(projectId, 'renders', input);
}

export async function uploadSourceImageAsset(
  projectId: string,
  input: {
    buffer: Buffer;
    contentType?: string;
    filenameHint?: string;
  },
): Promise<UploadedAsset> {
  return uploadWorkerAsset(projectId, 'uploads', input);
}

export async function uploadWorkerAsset(
  projectId: string,
  group: string,
  input: {
    buffer: Buffer;
    contentType?: string;
    filenameHint?: string;
  },
): Promise<UploadedAsset> {
  const extension = detectExtension(input.filenameHint, input.contentType);
  const filename = `${utcDateStamp()}-${randomBytes(4).toString('base64url')}.${extension}`;
  const assetUri = `assets://${group}/${filename}`;
  const key = buildObjectKey(projectId, assetUri);
  const contentType = input.contentType || guessContentTypeFromFilename(filename);

  await getS3Client().send(new PutObjectCommand({
    Bucket: PAI_ASSET_BUCKET,
    Key: key,
    Body: input.buffer,
    ContentType: contentType,
  }));

  return {
    assetUri,
    filename,
    bytes: input.buffer.byteLength,
    contentType,
  };
}

function getS3Client(): S3Client {
  if (client) {
    return client;
  }

  if (!PAI_ASSET_BUCKET || !PAI_ASSET_ACCESS_KEY_ID || !PAI_ASSET_SECRET_ACCESS_KEY) {
    throw new Error('PAI asset store is not configured');
  }

  client = new S3Client({
    region: PAI_ASSET_REGION,
    endpoint: PAI_ASSET_ENDPOINT || undefined,
    credentials: {
      accessKeyId: PAI_ASSET_ACCESS_KEY_ID,
      secretAccessKey: PAI_ASSET_SECRET_ACCESS_KEY,
    },
    forcePathStyle: false,
  });
  return client;
}

function buildObjectKey(projectId: string, assetUri: string): string {
  const relativeAssetPath = normalizeAssetUri(assetUri).slice('assets://'.length);
  const prefix = renderPrefixTemplate(PAI_ASSET_PREFIX_TEMPLATE, projectId);
  return `${normalizePrefix(prefix || `${projectId}/`)}${relativeAssetPath}`;
}

function normalizeAssetUri(assetUri: string): string {
  const normalized = String(assetUri || '').trim();
  if (!normalized.startsWith('assets://')) {
    throw new Error(`assetUri must start with assets://: ${normalized || '(empty)'}`);
  }
  return normalized;
}

function normalizePrefix(prefix: string): string {
  const normalized = String(prefix || '').trim().replace(/^\/+/, '');
  if (!normalized) {
    return '';
  }
  return normalized.endsWith('/') ? normalized : `${normalized}/`;
}

function renderPrefixTemplate(template: string, projectId: string): string {
  const normalizedTemplate = String(template || '').trim();
  if (!normalizedTemplate) {
    return '';
  }
  return normalizedTemplate.replaceAll('{project_id}', String(projectId || '').trim());
}

function detectExtension(filenameHint?: string, contentType?: string): string {
  const hinted = String(filenameHint || '').trim().toLowerCase();
  const matched = /\.([a-z0-9]+)$/i.exec(hinted);
  if (matched?.[1]) {
    const extension = matched[1] === 'jpeg' ? 'jpg' : matched[1];
    if (isSupportedExtension(extension)) {
      return extension;
    }
  }

  const normalizedType = String(contentType || '').toLowerCase();
  if (normalizedType.includes('x-blender')) {
    return 'blend';
  }
  if (normalizedType.includes('model/obj')) {
    return 'obj';
  }
  if (normalizedType.includes('png')) {
    return 'png';
  }
  if (normalizedType.includes('jpeg') || normalizedType.includes('jpg')) {
    return 'jpg';
  }
  if (normalizedType.includes('webp')) {
    return 'webp';
  }
  if (normalizedType.includes('json')) {
    return 'json';
  }
  if (normalizedType.includes('x-python')) {
    return 'py';
  }
  return 'png';
}

function guessContentTypeFromFilename(filename: string): string {
  const normalized = filename.toLowerCase();
  if (normalized.endsWith('.blend')) {
    return 'application/x-blender';
  }
  if (normalized.endsWith('.obj')) {
    return 'model/obj';
  }
  if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) {
    return 'image/jpeg';
  }
  if (normalized.endsWith('.webp')) {
    return 'image/webp';
  }
  if (normalized.endsWith('.json')) {
    return 'application/json';
  }
  if (normalized.endsWith('.py')) {
    return 'text/x-python';
  }
  return 'image/png';
}

function isSupportedExtension(extension: string): boolean {
  return ['blend', 'obj', 'png', 'jpg', 'webp', 'json', 'py'].includes(extension);
}

function utcDateStamp(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}
