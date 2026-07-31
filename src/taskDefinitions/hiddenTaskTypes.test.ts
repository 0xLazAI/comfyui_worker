import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HIDDEN_TASK_TYPES,
  excludeHiddenTaskTypeNames,
  excludeHiddenTaskTypes,
  isHiddenTaskType,
  parseHiddenTaskTypes,
} from './hiddenTaskTypes.js';

describe('parseHiddenTaskTypes', () => {
  it('falls back to the built-in list when the env var is unset', () => {
    expect([...parseHiddenTaskTypes(undefined)].sort()).toEqual([...DEFAULT_HIDDEN_TASK_TYPES].sort());
  });

  it('treats an explicit empty value as "hide nothing"', () => {
    expect([...parseHiddenTaskTypes('')]).toEqual([]);
    expect([...parseHiddenTaskTypes('  ')]).toEqual([]);
  });

  it('parses a comma separated override and trims entries', () => {
    expect([...parseHiddenTaskTypes(' blender , train_style_lora ,,')].sort()).toEqual([
      'blender',
      'train_style_lora',
    ]);
  });
});

describe('isHiddenTaskType', () => {
  it('hides every blender task type by default', () => {
    for (const taskType of DEFAULT_HIDDEN_TASK_TYPES) {
      expect(isHiddenTaskType(taskType)).toBe(true);
    }
  });

  it('keeps the task types this worker actually runs', () => {
    for (const taskType of ['render_panel', 'replace_prop_panel', 'train_style_lora', 'hunyuan3d_three_view']) {
      expect(isHiddenTaskType(taskType)).toBe(false);
    }
  });

  it('ignores surrounding whitespace and empty input', () => {
    expect(isHiddenTaskType(' blender ')).toBe(true);
    expect(isHiddenTaskType('')).toBe(false);
  });
});

describe('excludeHiddenTaskTypes', () => {
  it('drops hidden definitions without mutating the input', () => {
    const definitions = [
      { taskType: 'render_panel' },
      { taskType: 'blender_pace_3d' },
      { taskType: 'hunyuan3d_three_view' },
    ];

    const visible = excludeHiddenTaskTypes(definitions);

    expect(visible.map((definition) => definition.taskType)).toEqual(['render_panel', 'hunyuan3d_three_view']);
    expect(definitions).toHaveLength(3);
  });
});

describe('excludeHiddenTaskTypeNames', () => {
  it('drops hidden task type names', () => {
    expect(excludeHiddenTaskTypeNames(['blender', 'render_panel', 'blender_create_3d'])).toEqual(['render_panel']);
  });
});
