import { expect, test } from 'vitest';

import { ValidationError } from '../infra/HttpError.js';
import { normalizePayloadWithDefinition, normalizeTaskDefinitionJson } from './definitionSchema.js';

test('object fields accept plain objects and preserve nested payloads', () => {
  const definition = normalizeTaskDefinitionJson({
    consumer_key: 'blender_consumer',
    payload: {
      allow_unknown_fields: false,
      fields: {
        workflow: { type: 'string', required: true },
        pace: { type: 'object', required: true },
      },
    },
  });

  expect(
    normalizePayloadWithDefinition(
      {
        workflow: 'blender-create-3d',
        pace: { schema_version: 'test', scene: { scene_id: 's001' } },
      },
      definition,
    ),
  ).toEqual({
    workflow: 'blender-create-3d',
    pace: { schema_version: 'test', scene: { scene_id: 's001' } },
  });
});

test('object fields reject arrays, null, and scalars', () => {
  const definition = normalizeTaskDefinitionJson({
    consumer_key: 'blender_consumer',
    payload: {
      fields: {
        pace: { type: 'object', required: true },
      },
    },
  });

  expect(() => normalizePayloadWithDefinition({ pace: [] }, definition)).toThrowError(ValidationError);
  expect(() => normalizePayloadWithDefinition({ pace: null }, definition)).toThrowError(ValidationError);
  expect(() => normalizePayloadWithDefinition({ pace: 'invalid' }, definition)).toThrowError(ValidationError);
});

test('json fields accept json-compatible values including null', () => {
  const definition = normalizeTaskDefinitionJson({
    consumer_key: 'blender_consumer',
    payload: {
      fields: {
        object_value: { type: 'json', required: true },
        array_value: { type: 'json', required: true },
        string_value: { type: 'json', required: true },
        number_value: { type: 'json', required: true },
        boolean_value: { type: 'json', required: true },
        null_value: { type: 'json', required: true },
      },
    },
  });

  expect(
    normalizePayloadWithDefinition(
      {
        object_value: { scene: { id: 's001' } },
        array_value: ['camera', 2, false, null, { lens: 35 }],
        string_value: 'blender',
        number_value: 42.5,
        boolean_value: true,
        null_value: null,
      },
      definition,
    ),
  ).toEqual({
    object_value: { scene: { id: 's001' } },
    array_value: ['camera', 2, false, null, { lens: 35 }],
    string_value: 'blender',
    number_value: 42.5,
    boolean_value: true,
    null_value: null,
  });
});

test('object and json defaults are cloned for each normalized payload', () => {
  const definition = normalizeTaskDefinitionJson({
    consumer_key: 'blender_consumer',
    payload: {
      fields: {
        pace: {
          type: 'object',
          default: { schema_version: 'v1', scene: { id: 's001' } },
        },
        assets: {
          type: 'json',
          default: [{ id: 'a1' }, { id: 'a2' }],
        },
      },
    },
  });

  const first = normalizePayloadWithDefinition({}, definition);
  const second = normalizePayloadWithDefinition({}, definition);

  const firstPace = first.pace as { scene: { id: string } };
  const secondPace = second.pace as { scene: { id: string } };
  const firstAssets = first.assets as Array<{ id: string }>;
  const secondAssets = second.assets as Array<{ id: string }>;

  firstPace.scene.id = 'changed';
  firstAssets[0]!.id = 'changed';

  expect(secondPace.scene.id).toBe('s001');
  expect(secondAssets[0]!.id).toBe('a1');
  expect(first.pace).not.toBe(second.pace);
  expect(first.assets).not.toBe(second.assets);
});

test('required fields and unknown field rejection still work with object and json rules', () => {
  const definition = normalizeTaskDefinitionJson({
    consumer_key: 'blender_consumer',
    payload: {
      allow_unknown_fields: false,
      fields: {
        workflow: { type: 'string', required: true },
        config: { type: 'object' },
        metadata: { type: 'json' },
      },
    },
  });

  expect(() =>
    normalizePayloadWithDefinition(
      {
        config: { renderer: 'cycles' },
      },
      definition,
    ),
  ).toThrow('payload.workflow is required');

  expect(() =>
    normalizePayloadWithDefinition(
      {
        workflow: 'render',
        config: { renderer: 'cycles' },
        metadata: ['draft'],
        unsupported: true,
      },
      definition,
    ),
  ).toThrow('payload contains unsupported fields: unsupported');
});

test('minimum and maximum are rejected for object and json fields', () => {
  expect(() =>
    normalizeTaskDefinitionJson({
      consumer_key: 'blender_consumer',
      payload: {
        fields: {
          pace: { type: 'object', minimum: 1 },
        },
      },
    }),
  ).toThrow('definition_json.payload.fields.pace.minimum is only allowed for number or integer fields');

  expect(() =>
    normalizeTaskDefinitionJson({
      consumer_key: 'blender_consumer',
      payload: {
        fields: {
          metadata: { type: 'json', maximum: 5 },
        },
      },
    }),
  ).toThrow('definition_json.payload.fields.metadata.maximum is only allowed for number or integer fields');
});

test('number and integer behavior remains unchanged', () => {
  const definition = normalizeTaskDefinitionJson({
    consumer_key: 'blender_consumer',
    payload: {
      fields: {
        width: { type: 'number', minimum: 0.5, maximum: 2.5 },
        samples: { type: 'integer', minimum: 1, maximum: 32 },
      },
    },
  });

  expect(
    normalizePayloadWithDefinition(
      {
        width: '1.25',
        samples: '7.9',
      },
      definition,
    ),
  ).toEqual({
    width: 1.25,
    samples: 7,
  });

  expect(() => normalizePayloadWithDefinition({ width: 0.1, samples: 2 }, definition)).toThrow('payload.width must be >= 0.5');
  expect(() => normalizePayloadWithDefinition({ width: 1, samples: 64 }, definition)).toThrow('payload.samples must be <= 32');
});
