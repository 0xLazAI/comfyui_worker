import { logger } from '../infra/logger.js';
import { paiPlatformClient } from '../platform/paiPlatformClient.js';
import type { EntityKind } from './threeViewPayload.js';

const ENTITY_FILE: Record<EntityKind, string> = {
  character: 'entities/characters.json',
  prop: 'entities/props.json',
  location: 'entities/locations.json',
};

/** Project-level manifest that holds asset artifact takes (artifacts[]). */
const PROJECT_MANIFEST = 'manifest.json';
/** PACE artifact kind for a 3D model asset (see docs/pace artifact_item registry). */
const MODEL3D_KIND = 'asset_model3d';
const MODEL3D_MEDIA_TYPE = 'model/gltf-binary';

export interface RegisterModel3dResult {
  /** Entity ledger file the model3d slot was written to. */
  path: string;
  /** JSON Pointer of the model3d slot within the ledger file. */
  pointer: string;
  /** Index of the entity within the ledger array. */
  entityIndex: number;
  /** versionId of the appended asset_model3d take (mirrored into the slot). */
  versionId: string;
}

export interface RegisterModel3dInput {
  projectId: string;
  entityKind: EntityKind;
  entityId: string;
  depictionIndex: number | null;
  assetUri: string;
  /** SHA-256 of the exact GLB bytes uploaded to asset storage. */
  contentHash: string;
  /** Human-readable producer tag, e.g. "pailang:hunyuan3d_mv". */
  backend?: string;
  /** Upstream modeling job id (for take lineage disambiguation / audit). */
  jobId?: string | null;
  /** ISO timestamp for the take's createdAt; defaults to now. */
  now?: string;
}

/**
 * Register a produced GLB (assets:// URI) as the current 3D model of a character/prop.
 *
 * PACE discipline (08 §4 + std-1): a produced asset is appended as an **artifact take**
 * to the project manifest's `artifacts[]` (append-only, never overwritten), the take is
 * marked `current` while any prior current take in the same group `(kind, ref)` is unset,
 * and the entity's `model3d` **slot** mirrors the current take. Take append + slot mirror
 * are sent as one `writePaceFiles` batch so they land atomically (no orphan GLB / drift).
 */
export async function registerEntityModel3d(input: RegisterModel3dInput): Promise<RegisterModel3dResult> {
  const ledgerPath = ENTITY_FILE[input.entityKind];
  if (!ledgerPath) {
    throw new Error(`no asset ledger for entity kind: ${input.entityKind}`);
  }
  const now = input.now ?? new Date().toISOString();
  if (!/^[0-9a-f]{64}$/.test(input.contentHash)) {
    throw new Error('model3d contentHash must be a lowercase SHA-256 digest');
  }

  // Resolve the entity's index in its ledger array.
  const ledgerFile = await paiPlatformClient.readPaceFile(input.projectId, ledgerPath);
  const entities = ledgerFile.value;
  if (!Array.isArray(entities)) {
    throw new Error(`asset ledger ${ledgerPath} is not an array of entities`);
  }
  const index = entities.findIndex(
    (entity) => entity && typeof entity === 'object'
      && String((entity as Record<string, unknown>).id || '') === input.entityId,
  );
  if (index < 0) {
    throw new Error(`entity ${input.entityId} not found in ${ledgerPath}`);
  }

  // Read the project manifest's artifact list (may be missing on a fresh project).
  const manifestFile = await paiPlatformClient.readPaceFile(input.projectId, PROJECT_MANIFEST)
    .catch(() => ({ value: {} as unknown }));
  const manifestValue = (manifestFile.value && typeof manifestFile.value === 'object')
    ? manifestFile.value as Record<string, unknown>
    : {};
  const artifactsPresent = Array.isArray(manifestValue.artifacts);
  const artifacts = (artifactsPresent ? manifestValue.artifacts : []) as Array<Record<string, unknown>>;

  const { versionId, supersedesId } = nextTakeLineage(artifacts, input.entityId, input.jobId ?? null);

  const take: Record<string, unknown> = {
    kind: MODEL3D_KIND,
    uri: input.assetUri,
    ref: input.entityId,
    versionId,
    contentHash: input.contentHash,
    current: true,
    supersedesId,
    createdAt: now,
    source: 'worker_generated',
    // A completed model task is the worker's deterministic selection of its
    // own output. Scene-spatial's formal artifact provenance requires this
    // explicit authority rather than treating a current ready artifact as an
    // implicit human choice.
    selectionAuthority: 'automatic',
    status: 'ready',
    mediaType: MODEL3D_MEDIA_TYPE,
  };
  if (input.backend) take.backend = input.backend;
  if (input.jobId) take.jobId = input.jobId;

  // Unset `current` on any prior current take in the same (kind, ref) group.
  const unsetOps = artifacts
    .map((artifact, i) => ({ artifact, i }))
    .filter(({ artifact }) => inGroup(artifact, input.entityId) && artifact.current === true)
    .map(({ i }) => ({ op: 'add' as const, path: `/artifacts/${i}/current`, value: false }));

  const manifestOps = [
    ...(artifactsPresent ? [] : [{ op: 'add' as const, path: '/artifacts', value: [] as unknown }]),
    ...unsetOps,
    { op: 'add' as const, path: '/artifacts/-', value: take },
  ];

  // The entity slot mirrors the current take. `add` (not `replace`) so the first write
  // succeeds even though the slot key does not exist yet (strict RFC6902 replace would fail).
  const pointer = input.depictionIndex === null
    ? `/${index}/model3d`
    : `/${index}/depictions/${input.depictionIndex}/model3d`;
  const slot = {
    status: 'ready',
    uri: input.assetUri,
    source: 'generated',
    group: `${MODEL3D_KIND}:${input.entityId}`,
    versionId,
    contentHash: input.contentHash,
    format: 'glb',
    filename: input.assetUri.split('/').pop() || `${input.entityId}.glb`,
  };

  const entity = entities[index] as Record<string, unknown>;
  const currentPreviz = entity.previzModel;
  const ledgerOperations: Array<{ op: 'add'; path: string; value: unknown }> = [
    { op: 'add', path: pointer, value: slot },
  ];
  if (
    input.depictionIndex === null
    && currentPreviz
    && typeof currentPreviz === 'object'
    && !Array.isArray(currentPreviz)
    && (currentPreviz as Record<string, unknown>).source === 'model3d'
  ) {
    ledgerOperations.push({
      op: 'add',
      path: `/${index}/previzModel`,
      value: {
        source: 'model3d',
        uri: input.assetUri,
        format: 'glb',
        filename: slot.filename,
        selectedAt: now,
        selectionAuthority: 'human',
      },
    });
  }

  const response = await paiPlatformClient.writePaceFiles(input.projectId, {
    patches: [
      { path: PROJECT_MANIFEST, operations: manifestOps },
      { path: ledgerPath, operations: ledgerOperations },
    ],
  });
  if (!response.validation.ok) {
    throw new Error(formatPaceValidationIssues(response.validation.issues));
  }

  return { path: ledgerPath, pointer, entityIndex: index, versionId };
}

/**
 * Read a PROP's intrinsic `physicalAttributes.bboxM` (meters) from its ledger,
 * for the metric bake.
 *
 * **Prop-only by design.** A character's size authority is single-axis `heightM`
 * (prop-3d-size proposal §4.5); PACE lets a character carry an optional `bboxM`,
 * but a per-axis metric bake on a character would distort it worse than the
 * height-normalized path — so characters always return null here, structurally,
 * not by relying on their data happening to omit bboxM.
 *
 * Returns null when: the kind isn't a prop; the prop has no valid bboxM; or the
 * ledger read FAILS. A read failure is logged (distinct from a genuine absence)
 * so a silent "wanted metric → got normalized" downgrade stays diagnosable, but
 * it never blocks modeling. Axis order is PACE std-2b `[width, depth, height]`
 * (z=height), forwarded verbatim; correctness depends on the estimator writing
 * that order (storyboard-tool#157 / proposal S2).
 */
export async function readEntityBboxM(input: {
  projectId: string;
  entityKind: EntityKind;
  entityId: string;
}): Promise<[number, number, number] | null> {
  if (input.entityKind !== 'prop') return null;
  const ledgerPath = ENTITY_FILE[input.entityKind];
  if (!ledgerPath) return null;

  let ledgerFile: { value: unknown };
  try {
    ledgerFile = await paiPlatformClient.readPaceFile(input.projectId, ledgerPath);
  } catch (err) {
    logger.warn(
      'readEntityBboxM: ledger read failed, prop uses normalized GLB — project=%s entity=%s: %s',
      input.projectId, input.entityId, err instanceof Error ? err.message : String(err),
    );
    return null;
  }

  if (!Array.isArray(ledgerFile.value)) return null;
  const entity = ledgerFile.value.find(
    (e) => e && typeof e === 'object'
      && String((e as Record<string, unknown>).id || '') === input.entityId,
  ) as Record<string, unknown> | undefined;
  const pa = entity?.physicalAttributes;
  if (!pa || typeof pa !== 'object') return null;
  const raw = (pa as Record<string, unknown>).bboxM;
  if (!Array.isArray(raw) || raw.length !== 3) return null;
  const dims = raw.map((n) => (typeof n === 'number' && Number.isFinite(n) ? n : NaN));
  if (!dims.every((n) => n > 0)) return null;
  return [dims[0], dims[1], dims[2]] as [number, number, number];
}

/** True if an artifact belongs to the model3d take group of the given entity. */
function inGroup(artifact: Record<string, unknown>, entityId: string): boolean {
  return !!artifact
    && typeof artifact === 'object'
    && artifact.kind === MODEL3D_KIND
    && (artifact.panelId ?? null) === null
    && (artifact.ref ?? null) === entityId
    && (artifact.role ?? null) === null;
}

/**
 * Compute the next take's (versionId, supersedesId) for the (asset_model3d, entityId) group.
 * versionId = `asset_take_<n>[_<job6>]`; supersedesId points at the group's previous take
 * (null for the first). Mirrors storyboard-tool's `_next_take_lineage` so both workers write
 * consistent lineage into the same project manifest.
 */
function nextTakeLineage(
  artifacts: Array<Record<string, unknown>>,
  entityId: string,
  jobId: string | null,
): { versionId: string; supersedesId: string | null } {
  let count = 0;
  let last: string | null = null;
  for (const artifact of artifacts) {
    if (!inGroup(artifact, entityId)) continue;
    count += 1;
    const vid = artifact.versionId;
    if (typeof vid === 'string' && vid) last = vid;
  }
  const suffix = jobId ? `_${String(jobId).trim().slice(0, 6)}` : '';
  return { versionId: `asset_take_${count + 1}${suffix}`, supersedesId: last };
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
