import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const sendMock = vi.fn();

vi.mock('@aws-sdk/client-s3', () => {
  class S3Client {
    send = sendMock;
  }

  class PutObjectCommand {
    input: Record<string, unknown>;

    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  }

  class GetObjectCommand {
    input: Record<string, unknown>;

    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  }

  return {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
  };
});

async function loadAssetStore() {
  process.env.PAI_ASSET_BUCKET = 'test-bucket';
  process.env.PAI_ASSET_ACCESS_KEY_ID = 'test-access-key';
  process.env.PAI_ASSET_SECRET_ACCESS_KEY = 'test-secret-key';
  process.env.PAI_ASSET_PREFIX_TEMPLATE = 'projects/{project_id}';

  vi.resetModules();
  return import('./assetStore.js');
}

beforeEach(() => {
  sendMock.mockReset();
  sendMock.mockResolvedValue({});
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-06-10T12:34:56.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.PAI_ASSET_BUCKET;
  delete process.env.PAI_ASSET_ACCESS_KEY_ID;
  delete process.env.PAI_ASSET_SECRET_ACCESS_KEY;
  delete process.env.PAI_ASSET_PREFIX_TEMPLATE;
});

test.each([
  ['scene.blend', 'blend', 'application/x-blender'],
  ['mesh.obj', 'obj', 'model/obj'],
  ['render.png', 'png', 'image/png'],
  ['metadata.json', 'json', 'application/json'],
  ['script.py', 'py', 'text/x-python'],
])('uploadWorkerAsset infers %s as %s with %s', async (filenameHint, extension, contentType) => {
  const { uploadWorkerAsset } = await loadAssetStore();
  const buffer = Buffer.from('asset-bytes');

  const uploaded = await uploadWorkerAsset('project-123', 'blender-artifacts', {
    buffer,
    filenameHint,
  });

  expect(uploaded.contentType).toBe(contentType);
  expect(uploaded.bytes).toBe(buffer.byteLength);
  expect(uploaded.filename).toMatch(new RegExp(`^20260610-[A-Za-z0-9_-]+\\.${extension}$`));
  expect(uploaded.assetUri).toBe(`assets://blender-artifacts/${uploaded.filename}`);

  const [command] = sendMock.mock.calls[0] || [];
  expect(command.input).toMatchObject({
    Bucket: 'test-bucket',
    Key: `projects/project-123/blender-artifacts/${uploaded.filename}`,
    Body: buffer,
    ContentType: contentType,
  });
});

test.each([
  ['uploadRenderAsset', 'renders'],
  ['uploadSourceImageAsset', 'uploads'],
])('%s uploads through its fixed asset group', async (methodName, group) => {
  const assetStore = await loadAssetStore();
  const buffer = Buffer.from('image');

  const uploaded = await assetStore[methodName as 'uploadRenderAsset' | 'uploadSourceImageAsset']('project-456', {
    buffer,
    filenameHint: 'preview.png',
  });

  expect(uploaded.assetUri).toBe(`assets://${group}/${uploaded.filename}`);

  const [command] = sendMock.mock.calls[0] || [];
  expect(command.input).toMatchObject({
    Key: `projects/project-456/${group}/${uploaded.filename}`,
    ContentType: 'image/png',
  });
});
