import { paiPlatformClient } from '../platform/paiPlatformClient.js';
import type { EntityKind } from './threeViewPayload.js';

const ENTITY_FILE: Record<EntityKind, string> = {
  character: 'entities/characters.json',
  prop: 'entities/props.json',
};

export interface RegisterModel3dResult {
  path: string;
  pointer: string;
  entityIndex: number;
}

/** Attach a produced GLB (assets:// URI) to a character/prop's `model3d` slot in
 *  the PACE asset ledger. The ledger file is a JSON array of entities; we resolve
 *  the entity's index by id, then REPLACE its `model3d` assetRef (idempotent on
 *  retry — a re-run overwrites the same slot rather than duplicating). */
export async function registerEntityModel3d(input: {
  projectId: string;
  entityKind: EntityKind;
  entityId: string;
  depictionIndex: number | null;
  assetUri: string;
}): Promise<RegisterModel3dResult> {
  const path = ENTITY_FILE[input.entityKind];
  const file = await paiPlatformClient.readPaceFile(input.projectId, path);
  const entities = file.value;
  if (!Array.isArray(entities)) {
    throw new Error(`asset ledger ${path} is not an array of entities`);
  }

  const index = entities.findIndex(
    (entity) => entity && typeof entity === 'object'
      && String((entity as Record<string, unknown>).id || '') === input.entityId,
  );
  if (index < 0) {
    throw new Error(`entity ${input.entityId} not found in ${path}`);
  }

  const pointer = input.depictionIndex === null
    ? `/${index}/model3d`
    : `/${index}/depictions/${input.depictionIndex}/model3d`;
  const value = {
    status: 'ready',
    uri: input.assetUri,
    source: 'generated',
    group: `asset_model3d:${input.entityId}`,
    versionId: 'take1',
  };

  const response = await paiPlatformClient.writePaceFiles(input.projectId, {
    patches: [{
      path,
      operations: [{ op: 'REPLACE', path: pointer, value }],
    }],
  });
  if (!response.validation.ok) {
    throw new Error(formatPaceValidationIssues(response.validation.issues));
  }

  return { path, pointer, entityIndex: index };
}

function formatPaceValidationIssues(issues: Array<Record<string, unknown>>): string {
  if (!issues?.length) {
    return 'PACE validation failed while writing model3d.';
  }
  const messages = issues.map((issue) => {
    const at = String(issue.path || issue.field || '').trim();
    return `${at ? `${at}: ` : ''}${String(issue.message || issue.code || 'invalid')}`;
  });
  return `PACE validation failed: ${messages.join('; ')}`;
}
