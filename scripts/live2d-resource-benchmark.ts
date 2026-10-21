import { performance } from 'node:perf_hooks';
import { capabilitiesFromManifest } from '../app/plugins/live2d/capabilities';
import { emptyActionProfile } from '../app/plugins/live2d/actionProfile';
import { effectiveResourceUses } from '../app/plugins/live2d/resourceConfig';
import { filterResources, indexResourceUses, RESOURCE_PAGE_SIZE } from '../app/plugins/live2d/resourceIndex';
for (const count of [100, 1000, 5000]) {
  const caps = capabilitiesFromManifest({ FileReferences: { Motions: { Idle: Array.from({ length: count }, (_, i) => ({ File: `motion-${i}.json` })) } } });
  const profile = emptyActionProfile(), timings: number[] = [];
  for (let run = 0; run < 31; run++) {
    const start = performance.now();
    const uses = indexResourceUses(effectiveResourceUses(profile, caps));
    const result = filterResources(caps.actions, profile, uses, `motion-${count - 1}.json`, 'motion', 'idle');
    if (result.length !== 1) throw new Error('Search did not reach the final resource');
    if (run) timings.push(performance.now() - start);
  }
  timings.sort((a, b) => a - b);
  console.log(JSON.stringify({ resources: count, medianMs: +timings[15].toFixed(2), p95Ms: +timings[28].toFixed(2), maxMountedRows: Math.min(count, RESOURCE_PAGE_SIZE) }));
}
