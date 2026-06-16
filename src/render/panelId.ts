import { ValidationError } from '../infra/HttpError.js';

export interface ParsedPanelId {
  panelId: string;
  sceneId: string;
  shotId: string;
  panelNumber: string;
  providerSceneId: string;
  providerShotId: string;
  providerPanelId: string;
}

const LEGACY_PANEL_ID_PATTERN = /^scene_([^_]+)_shot_([^_]+)_panel_([^_]+)$/;
const CANONICAL_PANEL_ID_PATTERN = /^ps(\d+)_sh(\d+)_p(\d+)$/i;

export function parsePanelId(panelId: string): ParsedPanelId {
  const normalized = String(panelId || '').trim();
  const legacy = LEGACY_PANEL_ID_PATTERN.exec(normalized);
  if (legacy) {
    const sceneDigits = normalizeDigits(legacy[1] || '', 3, 'payload.panelId');
    const shotDigits = normalizeDigits(legacy[2] || '', 3, 'payload.panelId');
    const panelDigits = normalizeDigits(legacy[3] || '', 4, 'payload.panelId');
    return {
      panelId: `ps${sceneDigits}_sh${shotDigits}_p${panelDigits}`,
      sceneId: `s${sceneDigits}`,
      shotId: `hs${sceneDigits}_sh${shotDigits}`,
      panelNumber: panelDigits,
      providerSceneId: `scene_${legacy[1]}`,
      providerShotId: `shot_${legacy[2]}`,
      providerPanelId: normalized,
    };
  }

  const canonical = CANONICAL_PANEL_ID_PATTERN.exec(normalized);
  if (canonical) {
    const sceneDigits = normalizeDigits(canonical[1] || '', 3, 'payload.panelId');
    const shotDigits = normalizeDigits(canonical[2] || '', 3, 'payload.panelId');
    const panelDigits = normalizeDigits(canonical[3] || '', 4, 'payload.panelId');
    return {
      panelId: `ps${sceneDigits}_sh${shotDigits}_p${panelDigits}`,
      sceneId: `s${sceneDigits}`,
      shotId: `hs${sceneDigits}_sh${shotDigits}`,
      panelNumber: panelDigits,
      providerSceneId: `scene_${String(Number(sceneDigits)).padStart(2, '0')}`,
      providerShotId: `shot_${String(Number(shotDigits)).padStart(2, '0')}`,
      providerPanelId: `scene_${String(Number(sceneDigits)).padStart(2, '0')}_shot_${String(Number(shotDigits)).padStart(2, '0')}_panel_${panelDigits}`,
    };
  }

  throw new ValidationError('payload.panelId must match ps<scene>_sh<shot>_p<panel> or scene_<id>_shot_<id>_panel_<id>');
}

function normalizeDigits(value: string, width: number, field: string): string {
  const normalized = String(value || '').trim();
  if (!/^\d+$/.test(normalized)) {
    throw new ValidationError(`${field} contains invalid numeric segments`);
  }
  return String(Number(normalized)).padStart(width, '0');
}
