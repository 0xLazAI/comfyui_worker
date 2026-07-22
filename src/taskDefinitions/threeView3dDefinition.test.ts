/**
 * The `hunyuan3d_three_view` task definition vs. the payload the worker actually consumes.
 *
 * Encodes the WHY: a payload passes through TWO gates, and they are written in different
 * files with nothing tying them together —
 *   1. `normalizePayloadWithDefinition` — a field ALLOWLIST from the task definition, with
 *      `allow_unknown_fields: false`, so any field not listed is a hard 400 at the HTTP edge.
 *   2. `hydrateThreeView3dPayload` — the worker's own typing/validation.
 *
 * Adding a field to (2) without adding it to (1) means the field is rejected before the
 * worker ever sees it: the feature is dead in production while every unit test passes,
 * because unit tests call the hydrator directly and never cross gate (1). That is exactly
 * how `turnaround.formatVersion` / `turnaround.normalized` shipped broken — caught only by
 * a smoke test against the deployed box.
 *
 * So: these tests drive a realistic payload through BOTH gates in order.
 */

import { describe, expect, it } from 'vitest';
import { defaultThreeView3dDefinitionJson } from './taskTypeDefinitionStore.js';
import { normalizePayloadWithDefinition } from './definitionSchema.js';
import { hydrateThreeView3dPayload } from '../model3d/threeViewPayload.js';

const ctx = { taskId: 'task_1', projectId: 'proj_1' };
const target = { entityKind: 'prop', entityId: 'prop_table' };
const definition = defaultThreeView3dDefinitionJson();

/** Gate 1 → gate 2, exactly as app.ts does it. */
const throughBothGates = (payload: Record<string, unknown>) =>
  hydrateThreeView3dPayload(normalizePayloadWithDefinition(payload, definition), ctx);

describe('hunyuan3d_three_view definition ↔ payload contract', () => {
  it('the allowlist carries every model_input_sheet field the worker consumes', () => {
    // The allowlist is the gate the hydrator never sees. If a field the hydrator reads is
    // missing here, production 400s while unit tests stay green.
    const fields = Object.keys(definition.payload.fields);
    expect(fields).toContain('turnaround.assetUri');
    expect(fields).toContain('turnaround.formatVersion');
    expect(fields).toContain('turnaround.normalized');
  });

  it('accepts a real model_input_sheet payload end to end (the case that 400-ed in prod)', () => {
    const p = throughBothGates({
      turnaround: {
        assetUri: 'assets://x/entity_prop_table_model_v1_1536_1024.png',
        formatVersion: 'v1',
        normalized: true,
      },
      target,
    });
    expect(p.turnaround).toEqual({
      assetUri: 'assets://x/entity_prop_table_model_v1_1536_1024.png',
      formatVersion: 'v1',
      normalized: true,
    });
  });

  it('accepts target.bboxM through BOTH gates (the metric-bake field that 400-ed in prod)', () => {
    // The array rides under the `target` object umbrella: a bare top-level array field can't
    // be declared (the allowlist has no array type; object-typed leaves reject arrays), so it
    // must nest inside an object node that passes through whole. This is the regression guard
    // for exactly the gap that shipped — hydrator read it, allowlist 400-ed it.
    const p = throughBothGates({
      turnaround: { assetUri: 'assets://x/sheet.png' },
      target: { ...target, bboxM: [6, 6, 1] },
    });
    expect(p.bboxM).toEqual([6, 6, 1]);
  });

  it('still accepts a legacy styled sheet with no version fields', () => {
    const p = throughBothGates({ turnaround: { assetUri: 'assets://x/styled.png' }, target });
    expect(p.turnaround?.formatVersion).toBeNull();
    expect(p.turnaround?.normalized).toBe(false);
  });

  it('rejects an unknown formatVersion at the worker gate, not the allowlist', () => {
    // The allowlist only decides which field NAMES may appear; deciding which VERSIONS this
    // worker can slice is the hydrator's job. Both gates must let the field through for
    // that rejection to carry its real message.
    expect(() =>
      throughBothGates({
        turnaround: { assetUri: 'assets://x/s.png', formatVersion: 'v99' },
        target,
      }),
    ).toThrow(/formatVersion v99 is not supported/);
  });

  it('keeps allow_unknown_fields off — the allowlist is load-bearing, not advisory', () => {
    expect(definition.payload.allow_unknown_fields).toBe(false);
  });
});

describe('the contract does not assert turnaround’s internal shape', () => {
  it('passes a field storyboard-tool has not invented yet, with no contract change', () => {
    // The promise this design makes: upstream adds a field under `turnaround` (say a future
    // formatVersion carries extra metadata) and this worker needs NO edit here — no code, no
    // requiredFieldPaths, no deploy. Enumerating leaves is what made #10 ship dead: every
    // added field needed a three-step ritual, and missing one is a silent production 400.
    const normalized = normalizePayloadWithDefinition(
      {
        turnaround: {
          assetUri: 'assets://x/s.png',
          formatVersion: 'v1',
          normalized: true,
          somethingUpstreamAddsLater: { nested: 'value' },
        },
        target,
      },
      definition,
    );
    // Survives the gate AND reaches the worker intact — an allowlist that dropped unknown
    // sub-fields would be just as broken as one that rejected them.
    expect(normalized.turnaround).toEqual({
      assetUri: 'assets://x/s.png',
      formatVersion: 'v1',
      normalized: true,
      somethingUpstreamAddsLater: { nested: 'value' },
    });
  });

  it('still rejects an unknown TOP-LEVEL field — the umbrella opens one node, not the payload', () => {
    // `allow_unknown_fields: false` still means something: only `turnaround`'s interior is
    // open, because that interior is a contract owned upstream. A typo'd top-level key is
    // still a caller error worth catching.
    expect(() =>
      normalizePayloadWithDefinition({ turnround: { assetUri: 'assets://x/s.png' }, target }, definition),
    ).toThrow(/unsupported fields: turnround/);
  });

  it('validates that turnaround IS an object — open shape, still typed', () => {
    expect(() =>
      normalizePayloadWithDefinition({ turnaround: 'assets://x/s.png', target }, definition),
    ).toThrow(/turnaround/);
  });

  it('publishes the known leaves as schema, so the agent form still renders them', () => {
    // The leaves are documentation, not validation (the umbrella already passes everything).
    // WorkerRegistryPublisher turns `fields` into the worker's payloadSchema, which the
    // platform + the agent's run_worker_task_form widget render from. Collapsing turnaround
    // to a bare opaque object would have cost that, so both live side by side:
    // **validation is the worker's job, documentation is the contract's**.
    const fields = Object.keys(definition.payload.fields);
    expect(fields).toContain('turnaround');
    expect(fields).toContain('turnaround.assetUri');
    expect(definition.payload.fields['turnaround']?.type).toBe('object');
  });
});
