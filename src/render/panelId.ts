import { ValidationError } from '../infra/HttpError.js';

export interface ParsedPanelId {
  panelId: string;
  sceneId: string;
  shotId: string;
  panelNumber: string;
}

const PANEL_ID_PATTERN = /^(scene_[^_]+)_(shot_[^_]+)_panel_([^_]+)$/;

export function parsePanelId(panelId: string): ParsedPanelId {
  const normalized = String(panelId || '').trim();
  const matched = PANEL_ID_PATTERN.exec(normalized);
  if (!matched) {
    throw new ValidationError('payload.panelId must match scene_<id>_shot_<id>_panel_<id>');
  }

  return {
    panelId: normalized,
    sceneId: matched[1] || '',
    shotId: matched[2] || '',
    panelNumber: matched[3] || '',
  };
}
