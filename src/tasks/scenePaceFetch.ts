import { paiPlatformClient } from '../platform/paiPlatformClient.js';
import { TaskRejectedError } from '../render/errors.js';
import type { JsonObject, PaceDocument, PaceDocumentScene } from '../blender/types.js';

export interface ShotReviewInput {
  /** Single-scene PACE document carrying the scene's physicalLayout + this one shot. */
  paceDocument: PaceDocument;
  /** assets:// URI of the shot's `shot_glb` artifact (the base GLB to audit/fix). */
  glbAssetUri: string;
}

/**
 * Prepares one shot for blender-pace-review by reading its PACE files from the Pai
 * Platform (the same GraphQL surface the frontend previz stage uses) and locating
 * its base GLB artifact:
 *
 *   scenes/<sceneId>/manifest.json                 -> scene_doc (physicalLayout ...)
 *   scenes/<sceneId>/shots/<shotId>/manifest.json  -> shot pillars + artifacts[]
 *
 * The base GLB is the shot artifact with kind `shot_glb`; the corrected GLB is later
 * written back as kind `glb_checked` (see writeShotGlbCheckedArtifact).
 */
export async function fetchShotReviewInput(
  projectId: string,
  sceneId: string,
  shotId: string,
): Promise<ShotReviewInput> {
  const sceneManifestPath = `scenes/${sceneId}/manifest.json`;
  const shotManifestPath = `scenes/${sceneId}/shots/${shotId}/manifest.json`;

  const [sceneFile, shotFile] = await Promise.all([
    paiPlatformClient.readPaceFile(projectId, sceneManifestPath),
    paiPlatformClient.readPaceFile(projectId, shotManifestPath),
  ]);

  const sceneDoc = asJsonObject(sceneFile.value, sceneManifestPath);
  const shotDoc = asJsonObject(shotFile.value, shotManifestPath);

  const glbAssetUri = findArtifactUri(shotDoc, SHOT_GLB_KIND);
  if (!glbAssetUri) {
    throw new TaskRejectedError(
      `shot ${shotId} has no ${SHOT_GLB_KIND} artifact in ${shotManifestPath}`,
      'shot_glb_missing',
    );
  }

  const scene: PaceDocumentScene = {
    ...sceneDoc,
    sceneId,
    shots: [shotDoc],
  };

  return {
    paceDocument: { scenes: [scene] },
    glbAssetUri,
  };
}

// The shot's base previs GLB is uploaded by the frontend/render_3d producer as a
// `3d_storyboard` artifact; pace-review writes the corrected GLB back as `3d_storyboard_op`.
export const SHOT_GLB_KIND = '3d_storyboard';
export const GLB_CHECKED_KIND = '3d_storyboard_op';

/**
 * Appends the corrected GLB to the shot manifest as a `glb_checked` artifact
 * (JSON-Patch `add /artifacts/-`). Requires the shot manifest to already have an
 * `artifacts` array — true for any shot that carried a `shot_glb`.
 */
export async function writeShotGlbCheckedArtifact(input: {
  projectId: string;
  sceneId: string;
  shotId: string;
  assetUri: string;
  filename?: string;
  sourceGlbUri?: string | null;
}): Promise<void> {
  await paiPlatformClient.writePaceFiles(input.projectId, {
    patches: [
      {
        path: `scenes/${input.sceneId}/shots/${input.shotId}/manifest.json`,
        operations: [
          {
            op: 'add',
            path: '/artifacts/-',
            value: {
              kind: GLB_CHECKED_KIND,
              uri: input.assetUri,
              mediaType: 'model/gltf-binary',
              filename: input.filename || `${input.shotId}_checked.glb`,
              source: 'worker_generated',
              status: 'ready',
              createdAt: new Date().toISOString(),
              createdBy: { id: 'comfyui-blender-pace-review' },
              ...(input.sourceGlbUri ? { tags: [`from:${input.sourceGlbUri}`] } : {}),
            },
          },
        ],
      },
    ],
  });
}

/** Returns the latest `assets://` uri among a shot manifest's artifacts of the given kind. */
function findArtifactUri(shotDoc: JsonObject, kind: string): string | null {
  const artifacts = Array.isArray(shotDoc.artifacts) ? shotDoc.artifacts : [];
  // Iterate in reverse so the most recently appended artifact of this kind wins.
  for (let index = artifacts.length - 1; index >= 0; index -= 1) {
    const artifact = artifacts[index];
    if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
      continue;
    }
    const record = artifact as JsonObject;
    const uri = String(record.uri || '').trim();
    if (record.kind === kind && uri.startsWith('assets://')) {
      return uri;
    }
  }
  return null;
}

function asJsonObject(value: unknown, path: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TaskRejectedError(`PACE file is not a JSON object: ${path}`, 'pace_file_invalid');
  }
  return value as JsonObject;
}
