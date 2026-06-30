import { PaiPlatformApiError } from '../platform/paiPlatformClient.js';
import { downloadAsset, uploadRenderAsset, type DownloadedAsset, type UploadedAsset } from './assetStore.js';
import { TaskRejectedError } from './errors.js';
import {
  downloadStephenRenderImage,
  submitStephenRender,
  type StephenRenderStatus,
  type StephenRenderTarget,
} from './stephenRenderClient.js';

export interface StephenWorkflowSubmissionResult {
  sourceImage: DownloadedAsset;
  submitted: StephenRenderStatus;
}

export async function submitStephenImageWorkflow(options: {
  target: StephenRenderTarget;
  sourceImageAssetUri: string;
  buildSubmitBody: (sourceImageBase64: string) => Record<string, unknown>;
}): Promise<StephenWorkflowSubmissionResult> {
  const sourceImage = await downloadSourceImageOrReject(options.target.projectId, options.sourceImageAssetUri);
  const submitted = await submitStephenRender(
    options.target,
    options.buildSubmitBody(sourceImage.buffer.toString('base64')),
  );

  return {
    sourceImage,
    submitted,
  };
}

export async function finalizeStephenImageWorkflow(
  projectId: string,
  status: StephenRenderStatus,
): Promise<UploadedAsset> {
  const renderedImage = await downloadStephenRenderImage(status);
  return uploadRenderAsset(projectId, {
    buffer: renderedImage.buffer,
    contentType: renderedImage.contentType,
    filenameHint: renderedImage.filename,
  });
}

async function downloadSourceImageOrReject(projectId: string, assetUri: string): Promise<DownloadedAsset> {
  try {
    return await downloadAsset(projectId, assetUri);
  } catch (error: any) {
    const message = String(error?.message || error || '');
    if (error instanceof PaiPlatformApiError && error.statusCode === 404) {
      throw new TaskRejectedError(`source image asset does not exist: ${assetUri}`, 'source_asset_missing');
    }
    if (error?.name === 'NoSuchKey' || message.includes('NoSuchKey') || message.includes('The specified key does not exist')) {
      throw new TaskRejectedError(`source image asset does not exist: ${assetUri}`, 'source_asset_missing');
    }
    throw error;
  }
}
