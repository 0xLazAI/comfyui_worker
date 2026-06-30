// Real GraphQL query against the platform using the project's own client.
// Run: node scripts/verify-pace-query.mjs [projectId]
import { paiPlatformClient } from '../dist/platform/paiPlatformClient.js';
import { fetchScenePaceDocument } from '../dist/tasks/scenePaceFetch.js';
import { PLATFORM_API_BASE, PLATFORM_API_ENABLED } from '../dist/infra/constants.js';

const projectId = process.argv[2] || 'project-mqttw1na-sjmt0q';

function preview(value, max = 600) {
  const text = JSON.stringify(value, null, 2);
  return text.length > max ? `${text.slice(0, max)}\n... (${text.length} chars total)` : text;
}

async function main() {
  console.log(`platform=${PLATFORM_API_BASE} enabled=${PLATFORM_API_ENABLED} project=${projectId}\n`);

  console.log('=== 1) listPaceFiles(prefix="scenes/") ===');
  const sceneEntries = await paiPlatformClient.listPaceFiles(projectId, 'scenes/');
  console.log(`returned ${sceneEntries.length} entries`);
  console.log(preview(sceneEntries.slice(0, 20)));

  const sceneIds = [
    ...new Set(
      sceneEntries
        .map((e) => String(e.path || ''))
        .map((p) => /^scenes\/([^/]+)\//.exec(p)?.[1])
        .filter(Boolean),
    ),
  ];
  console.log(`\nderived scene ids: ${sceneIds.join(', ') || '(none)'}`);

  if (!sceneIds.length) {
    console.log('\nNo scenes found — stopping.');
    return;
  }

  const sceneId = sceneIds[0];
  console.log(`\n=== 2) readPaceFile(scenes/${sceneId}/manifest.json) ===`);
  const sceneFile = await paiPlatformClient.readPaceFile(projectId, `scenes/${sceneId}/manifest.json`);
  console.log(`path=${sceneFile.path} kind=${sceneFile.kind} format=${sceneFile.format}`);
  console.log(preview(sceneFile.value));

  console.log(`\n=== 3) fetchScenePaceDocument("${projectId}", "${sceneId}") ===`);
  const doc = await fetchScenePaceDocument(projectId, sceneId);
  const scene = doc.scenes[0];
  console.log(`scenes=${doc.scenes.length} scene_id=${scene.scene_id} shots=${Array.isArray(scene.shots) ? scene.shots.length : 0}`);
  console.log(preview(scene, 900));
}

main().then(
  () => {
    console.log('\nOK');
    process.exit(0);
  },
  (error) => {
    console.error('\nFAILED:', error?.message || error);
    if (error?.details) console.error('details:', JSON.stringify(error.details, null, 2));
    process.exit(1);
  },
);
