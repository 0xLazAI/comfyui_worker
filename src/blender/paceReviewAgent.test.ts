import { expect, test } from 'vitest';

import { buildPaceReviewPrompt, parsePaceReviewResponse } from './paceReviewAgent.js';
import type { GlbInventory } from './glbInspect.js';
import type { HydratedBlenderTaskPayload, PaceDocument } from './types.js';

const INVENTORY: GlbInventory = {
  nodeCount: 1,
  meshCount: 1,
  cameraCount: 0,
  animationCount: 0,
  lightCount: 0,
  nodes: [{ name: 'hero', translation: [1, 2, 0], worldTranslation: [1, 2, 0], hasMesh: true, isCamera: false, extras: null }],
  cameras: [],
  animations: [],
  lights: [],
  subjectGroups: [],
};

const DOCUMENT: PaceDocument = {
  scenes: [
    {
      schemaVersion: 'pace-0.2',
      sceneId: 's001',
      physicalLayout: {
        units: 'm',
        upAxis: 'Z',
        subjects: [{ ref: 'zhangwate@v1', worldXy: [0, 0.5], z: 1.2, facingDeg: 270 }],
        focusPoints: [{ id: 'fp_stage', worldXy: [0, 0.3], z: 2.4 }],
        cameraSetups: [{ shotId: 'hs001_sh001', worldXy: [0, -12], z: 0.8, lookingAt: 'fp_stage', lensMm: 24 }],
      },
      shots: [{ shotId: 'hs001_sh001', camera: { trajectory: { movement3d: ['push_in'] }, frameRange: [1, 96] } }],
    },
  ] as unknown as PaceDocument['scenes'],
};

const PAYLOAD: HydratedBlenderTaskPayload = {
  workflow: {
    id: 'blender-pace-review',
    summary: 'pace review',
    requiredFields: ['pace_document', 'inputs.base_glb.assetUri'],
    requiresSourceImage: false,
    artifactKinds: ['model_glb', 'review_report', 'generated_script'],
  },
  sceneId: 's001',
  shotId: 's001',
  modelId: null,
  prompt: null,
  pace: { schema_version: 'x', scene: { scene_id: 's001', shot_id: 's001' } },
  paceDocument: DOCUMENT,
  reviewBatch: null,
  agent: 'codex',
  runnerTarget: 'gpu',
  inputs: { sourceImageAssetUri: null, baseGlbAssetUri: 'assets://blender/base.glb' },
  taskId: 'task_1',
  projectId: 'project_1',
  projectRoot: '/data/pai-projects/demo',
};

test('buildPaceReviewPrompt includes the GLB inventory, PACE doc, and the inspect-then-fix method', () => {
  const prompt = buildPaceReviewPrompt(PAYLOAD, INVENTORY, DOCUMENT);
  expect(prompt).toContain('BASE GLB INVENTORY');
  expect(prompt).toContain('PACE DOCUMENT');
  expect(prompt).toContain('"name": "hero"');
  expect(prompt).toContain('cameraSetups');
  expect(prompt).toContain('worldXy');
  // Methodology from the per-workflow agent.md.
  expect(prompt.toLowerCase()).toContain('ground truth');
});

test('parsePaceReviewResponse parses report, issues, and fix script', () => {
  const text = JSON.stringify({
    report: '# PACE Review\n\n## Summary\n- Issues found: 1',
    issues: [
      { category: 'missing_camera', target: 'cam_a', description: 'cam_a absent', fixed: true, unfixableReason: null },
    ],
    script: 'import bpy\nbpy.ops.object.camera_add()',
    summary: 'Added missing camera cam_a.',
    notes: ['added cam_a'],
  });

  const parsed = parsePaceReviewResponse(text);
  expect(parsed.report).toContain('PACE Review');
  expect(parsed.issues).toHaveLength(1);
  expect(parsed.issues[0]).toMatchObject({ category: 'missing_camera', fixed: true, unfixableReason: null });
  expect(parsed.script).toContain('camera_add');
});

test('parsePaceReviewResponse rejects an empty fix script', () => {
  const text = JSON.stringify({ report: 'r', issues: [], script: '', summary: 's', notes: [] });
  expect(() => parsePaceReviewResponse(text)).toThrow(/script/);
});
