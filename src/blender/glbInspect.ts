/**
 * Lightweight GLB (binary glTF) inspector.
 *
 * The review agent (codex) cannot open a binary GLB itself, so the worker parses
 * the GLB's JSON chunk into a structured inventory — node names + translations,
 * cameras (with focal length derived from yfov), and animation channel targets —
 * and feeds that text to the agent alongside the PACE document. This is a
 * read-only parse of the glTF 2.0 container; it never executes Blender.
 *
 * GLB layout (little-endian): 12-byte header (magic "glTF", version, total
 * length) followed by chunks of [uint32 length][uint32 type][bytes]. The first
 * chunk (type 0x4E4F534A "JSON") holds the glTF document.
 */

const GLB_MAGIC = 0x46546c67; // "glTF"
const JSON_CHUNK_TYPE = 0x4e4f534a; // "JSON"

export interface GlbNodeInventory {
  name: string;
  /**
   * Node-local translation extracted from either the `translation` property or
   * the 4th column of a `matrix` (column-major). Null when neither is present.
   */
  translation: [number, number, number] | null;
  /**
   * Accumulated world translation computed by summing translations up the
   * parent chain (simple addition — correct when there are no rotations/scales
   * above this node, which is the common case for previz exports).
   */
  worldTranslation: [number, number, number] | null;
  hasMesh: boolean;
  isCamera: boolean;
  /**
   * Arbitrary extras attached to the node (e.g. `{ previzExport: "subject" }`).
   * Preserved verbatim so review agents can identify node roles.
   */
  extras: Record<string, unknown> | null;
}

export interface GlbCameraInventory {
  name: string;
  type: string;
  /** Vertical field of view in radians for perspective cameras; null otherwise. */
  yfov: number | null;
  /** Focal length in mm derived from yfov on a 36mm full-frame sensor; null otherwise. */
  focalLengthMm: number | null;
}

export interface GlbAnimationInventory {
  name: string;
  /** Distinct animated paths, e.g. "translation", "rotation". */
  targetPaths: string[];
  channelCount: number;
}

/** A KHR_lights_punctual light, with the node that places it (if any). */
export interface GlbLightInventory {
  name: string;
  /** directional | point | spot */
  type: string;
  /** glTF intensity (lux for directional, candela for point/spot); null if unset. */
  intensity: number | null;
  /** Linear RGB color [r,g,b] in 0..1; null when unspecified. */
  color: [number, number, number] | null;
  /** Name of the node that places this light, if any. */
  nodeName: string | null;
  /** World translation of the placing node (glTF Y-up); null if unplaced. */
  worldTranslation: [number, number, number] | null;
}

/**
 * A subject group is a node subtree tagged `extras.previzExport = "subject"`.
 * It represents an existing character in the GLB. `worldTranslation` is the
 * first non-null accumulated translation found among the group's descendants,
 * which is the character's world-space position in glTF Y-up coordinates.
 * The review agent should match these against PACE subjects by proximity
 * instead of declaring them missing.
 */
export interface GlbSubjectGroup {
  /** Node index of the subject root (the node with extras.previzExport = "subject"). */
  rootNodeIndex: number;
  /** Name of the root node. */
  rootNodeName: string;
  /**
   * World translation of the position node (first descendant with a non-null
   * translation). Null if the group has no positional descendant.
   */
  worldTranslation: [number, number, number] | null;
  /** Number of mesh-bearing nodes in this subtree (proxy for body-part count). */
  meshNodeCount: number;
}

export interface GlbInventory {
  nodeCount: number;
  meshCount: number;
  cameraCount: number;
  animationCount: number;
  lightCount: number;
  nodes: GlbNodeInventory[];
  cameras: GlbCameraInventory[];
  animations: GlbAnimationInventory[];
  /** KHR_lights_punctual lights (empty when the GLB has none — common for raw previs GLBs). */
  lights: GlbLightInventory[];
  /**
   * Subject groups extracted from nodes tagged `extras.previzExport = "subject"`.
   * Empty when the GLB has no such tags (e.g. it was built by a non-previz pipeline).
   * When non-empty, the review agent MUST use these for positional matching before
   * declaring any PACE subject as missing.
   */
  subjectGroups: GlbSubjectGroup[];
}

const FULL_FRAME_SENSOR_HEIGHT_MM = 36;

/** Extracts the glTF JSON document from a GLB buffer. Throws on a malformed container. */
export function parseGlbJson(buffer: Buffer): Record<string, unknown> {
  if (buffer.byteLength < 12) {
    throw new Error('GLB is too small to contain a header.');
  }
  const magic = buffer.readUInt32LE(0);
  if (magic !== GLB_MAGIC) {
    throw new Error('Not a binary glTF (GLB): missing "glTF" magic. Only .glb is supported.');
  }

  let offset = 12;
  while (offset + 8 <= buffer.byteLength) {
    const chunkLength = buffer.readUInt32LE(offset);
    const chunkType = buffer.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + chunkLength;
    if (dataEnd > buffer.byteLength) {
      throw new Error('GLB chunk length exceeds buffer size; file is truncated.');
    }
    if (chunkType === JSON_CHUNK_TYPE) {
      const jsonText = buffer.toString('utf8', dataStart, dataEnd);
      const parsed = JSON.parse(jsonText) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('GLB JSON chunk is not an object.');
      }
      return parsed as Record<string, unknown>;
    }
    offset = dataEnd;
  }

  throw new Error('GLB has no JSON chunk.');
}

export function inspectGlb(buffer: Buffer): GlbInventory {
  const gltf = parseGlbJson(buffer);
  const nodes = asArray(gltf.nodes);
  const meshes = asArray(gltf.meshes);
  const cameras = asArray(gltf.cameras);
  const animations = asArray(gltf.animations);

  // Build parent map so we can walk up the tree for world translation.
  const parentOf = new Map<number, number>();
  nodes.forEach((node, index) => {
    const record = asObject(node);
    for (const child of asArray(record.children)) {
      if (typeof child === 'number') parentOf.set(child, index);
    }
  });

  // Extract local translation from either `translation` or the 4th column of
  // a column-major `matrix` ([12], [13], [14]).
  function localTranslation(record: Record<string, unknown>): [number, number, number] | null {
    const fromProp = asVec3(record.translation);
    if (fromProp) return fromProp;
    const mat = asArray(record.matrix);
    if (mat.length === 16) {
      const tx = asNumber(mat[12]);
      const ty = asNumber(mat[13]);
      const tz = asNumber(mat[14]);
      if (tx !== null && ty !== null && tz !== null) return [tx, ty, tz];
    }
    return null;
  }

  // Accumulate translations up the parent chain (simple sum — correct when
  // ancestor nodes carry no rotation/scale, which is the norm for previz exports).
  function worldTranslation(index: number, localT: [number, number, number] | null): [number, number, number] | null {
    let wx = localT ? localT[0] : 0;
    let wy = localT ? localT[1] : 0;
    let wz = localT ? localT[2] : 0;
    let cur = parentOf.get(index);
    while (cur !== undefined) {
      const parentRecord = asObject(nodes[cur]);
      const pt = localTranslation(parentRecord);
      if (pt) { wx += pt[0]; wy += pt[1]; wz += pt[2]; }
      cur = parentOf.get(cur);
    }
    // Return null only when neither this node nor any ancestor has a translation.
    if (!localT && wx === 0 && wy === 0 && wz === 0) return null;
    return [wx, wy, wz];
  }

  const nodeInventory: GlbNodeInventory[] = nodes.map((node, index) => {
    const record = asObject(node);
    const localT = localTranslation(record);
    const extrasRaw = record.extras;
    const extras =
      extrasRaw && typeof extrasRaw === 'object' && !Array.isArray(extrasRaw)
        ? (extrasRaw as Record<string, unknown>)
        : null;
    return {
      name: asString(record.name) || `node_${index}`,
      translation: localT,
      worldTranslation: worldTranslation(index, localT),
      hasMesh: record.mesh !== undefined && record.mesh !== null,
      isCamera: record.camera !== undefined && record.camera !== null,
      extras,
    };
  });

  const cameraInventory: GlbCameraInventory[] = cameras.map((camera, index) => {
    const record = asObject(camera);
    const type = asString(record.type) || 'perspective';
    const perspective = asObject(record.perspective);
    const yfov = asNumber(perspective.yfov);
    return {
      name: asString(record.name) || `camera_${index}`,
      type,
      yfov,
      focalLengthMm: yfov !== null ? focalLengthFromYfov(yfov) : null,
    };
  });

  const animationInventory: GlbAnimationInventory[] = animations.map((animation, index) => {
    const record = asObject(animation);
    const channels = asArray(record.channels);
    const paths = new Set<string>();
    for (const channel of channels) {
      const target = asObject(asObject(channel).target);
      const path = asString(target.path);
      if (path) {
        paths.add(path);
      }
    }
    return {
      name: asString(record.name) || `animation_${index}`,
      targetPaths: Array.from(paths),
      channelCount: channels.length,
    };
  });

  // Count mesh-bearing descendants in a subtree.
  function countMeshDescendants(rootIdx: number): number {
    let count = 0;
    const stack = [...(asArray(asObject(nodes[rootIdx]).children) as number[])];
    while (stack.length > 0) {
      const ci = stack.pop()!;
      const child = nodeInventory[ci];
      if (!child) continue;
      if (child.hasMesh) count++;
      for (const gc of asArray(asObject(nodes[ci]).children)) {
        if (typeof gc === 'number') stack.push(gc);
      }
    }
    return count;
  }

  // Build subject groups from nodes tagged extras.previzExport = "subject".
  // The subject root has two kinds of direct children:
  //   1. A transform node (worldTranslation = foot position) that parents the body meshes.
  //   2. A facing indicator node (no mesh descendants) used as a look-at target.
  // We identify the body-group child as the direct child with the most mesh descendants,
  // and take its worldTranslation as the group's position.
  const subjectGroups: GlbSubjectGroup[] = nodeInventory
    .map((n, idx) => ({ n, idx }))
    .filter(({ n }) => n.extras?.previzExport === 'subject')
    .map(({ n, idx }) => {
      const directChildren = asArray(asObject(nodes[idx]).children).filter(
        (c): c is number => typeof c === 'number',
      );

      // Pick the direct child whose subtree contains the most meshes.
      let bodyChildIdx: number | null = null;
      let maxMeshCount = -1;
      let meshNodeCount = 0;
      for (const ci of directChildren) {
        const mc = countMeshDescendants(ci) + (nodeInventory[ci]?.hasMesh ? 1 : 0);
        if (mc > maxMeshCount) {
          maxMeshCount = mc;
          bodyChildIdx = ci;
          meshNodeCount = mc;
        }
      }

      const groupWorldTranslation =
        bodyChildIdx !== null ? (nodeInventory[bodyChildIdx]?.worldTranslation ?? null) : null;

      return {
        rootNodeIndex: idx,
        rootNodeName: n.name,
        worldTranslation: groupWorldTranslation,
        meshNodeCount,
      };
    });

  // KHR_lights_punctual: light definitions live under the document extension; each is
  // placed by the node that references it via node.extensions.KHR_lights_punctual.light.
  const punctualLights = asArray(asObject(asObject(gltf.extensions).KHR_lights_punctual).lights);
  const placingNodeByLight = new Map<number, GlbNodeInventory>();
  nodes.forEach((node, idx) => {
    const ref = asObject(asObject(asObject(node).extensions).KHR_lights_punctual).light;
    if (typeof ref === 'number' && nodeInventory[idx]) {
      placingNodeByLight.set(ref, nodeInventory[idx]);
    }
  });
  const lightInventory: GlbLightInventory[] = punctualLights.map((light, index) => {
    const record = asObject(light);
    const color = asArray(record.color);
    const placing = placingNodeByLight.get(index) || null;
    return {
      name: asString(record.name) || `light_${index}`,
      type: asString(record.type) || 'point',
      intensity: asNumber(record.intensity),
      color:
        color.length === 3 && color.every((c) => typeof c === 'number')
          ? (color as [number, number, number])
          : null,
      nodeName: placing?.name ?? null,
      worldTranslation: placing?.worldTranslation ?? null,
    };
  });

  return {
    nodeCount: nodes.length,
    meshCount: meshes.length,
    cameraCount: cameras.length,
    animationCount: animations.length,
    lightCount: punctualLights.length,
    nodes: nodeInventory,
    cameras: cameraInventory,
    animations: animationInventory,
    lights: lightInventory,
    subjectGroups,
  };
}

/** glTF cameras store yfov (radians). focal = (sensor_height / 2) / tan(yfov / 2). */
export function focalLengthFromYfov(yfov: number): number {
  const focal = FULL_FRAME_SENSOR_HEIGHT_MM / 2 / Math.tan(yfov / 2);
  return Math.round(focal * 100) / 100;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asVec3(value: unknown): [number, number, number] | null {
  if (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
  ) {
    return [value[0] as number, value[1] as number, value[2] as number];
  }
  return null;
}
