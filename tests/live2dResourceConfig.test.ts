import assert from 'node:assert/strict';
import { test } from 'node:test';
import { capabilitiesFromManifest } from '../app/plugins/live2d/capabilities';
import { emptyActionProfile, sanitizeActionProfile } from '../app/plugins/live2d/actionProfile';
import { effectiveResourceUses, idleResources, IdlePlaylist } from '../app/plugins/live2d/resourceConfig';

const caps = capabilitiesFromManifest({ HitAreas: [{ Id: 'Body', Name: 'Body' }], FileReferences: {
  Motions: { Idle: [{ File: 'idle1' }, { File: 'idle2' }], TapBody: [{ File: 'tap' }] }, Expressions: [{ Name: 'Smile', File: 'smile' }],
} });
test('v1 migration retains names, disabled bindings and missing references without changing model idle', () => {
  const migrated = sanitizeActionProfile({ version: 1, aliases: { missing: 'mine' }, bindings: { 'area:Body': { mode: 'disabled' }, 'key:A': { mode: 'manual', actionId: 'missing' } } });
  assert.equal(migrated.version, 2); assert.equal(migrated.aliases.missing, 'mine');
  assert.equal(migrated.bindings['area:Body'].mode, 'disabled'); assert.equal(migrated.idle.mode, 'model');
  assert.deepEqual(sanitizeActionProfile(JSON.parse(JSON.stringify(migrated))), migrated);
  assert.equal(effectiveResourceUses(migrated, caps).find(use => use.target === 'key:A')?.resolution.status, 'missing');
});
test('catalog uses include automatic idle and actual body binding, not a group-wide claim', () => {
  const profile = emptyActionProfile();
  const uses = effectiveResourceUses(profile, caps);
  assert.equal(uses.filter(use => use.target === 'idle').length, 2);
  assert.equal(uses.find(use => use.target === 'area:Body')?.resolution.status, 'action');
  profile.idle = { ...profile.idle, mode: 'custom', actionIds: [caps.actions[0].id, 'missing'] };
  assert.deepEqual(idleResources(profile, caps), [caps.actions[0]]);
  assert.ok(effectiveResourceUses(profile, caps).some(use => use.target === 'idle' && use.resolution.status === 'missing'));
});
test('playlist respects selected resources, sequence, no immediate random repeats and load failures', () => {
  const queue = new IdlePlaylist(), items = caps.actions.filter(action => action.group === 'Idle');
  assert.equal(queue.next(items, 'sequence')?.id, items[0].id);
  assert.equal(queue.next(items, 'sequence')?.id, items[1].id);
  assert.equal(queue.next(items, 'random', () => 0)?.id, items[0].id);
  queue.reject(items[1].id); assert.equal(queue.next(items, 'random')?.id, items[0].id);
  queue.reject(items[0].id); assert.equal(queue.next(items, 'sequence'), undefined);
  queue.reset(); assert.equal(queue.next(items, 'sequence')?.id, items[0].id);
});
