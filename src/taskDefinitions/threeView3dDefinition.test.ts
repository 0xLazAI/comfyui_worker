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
