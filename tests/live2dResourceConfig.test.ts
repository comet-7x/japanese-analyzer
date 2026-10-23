import { filterResources, indexResourceUses, RESOURCE_PAGE_SIZE } from '../app/plugins/live2d/resourceIndex';
import { countSettingChanges } from '../app/plugins/live2d/settingsFeedback';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { capabilitiesFromManifest } from '../app/plugins/live2d/capabilities';
import { emptyActionProfile, sanitizeActionProfile, resolvePointerTarget } from '../app/plugins/live2d/actionProfile';
import { effectiveResourceUses, idleResources, IdlePlaylist } from '../app/plugins/live2d/resourceConfig';
import { ExpressionLifecycle } from '../app/plugins/live2d/expressionLifecycle';

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
test('expression replacement, reset and disposal invalidate old timers and restore the current baseline', () => {
  const callbacks: Array<() => void> = [], applied: Array<string | null> = [];
  let baseline = 'outfit', finished = 0;
  const life = new ExpressionLifecycle(id => applied.push(id), () => baseline,
    callback => { callbacks.push(callback); return callbacks.length as unknown as ReturnType<typeof setTimeout>; }, () => {});
  life.activate('smile', 'timed', 3.5, () => finished++);
  life.activate('sad', 'timed', 2, () => finished++);
  callbacks[0](); assert.equal(applied.at(-1), 'sad'); assert.equal(finished, 0);
  baseline = 'new-outfit'; callbacks[1](); assert.equal(applied.at(-1), baseline); assert.equal(finished, 1);
  life.activate('smile', 'toggle', 3.5, () => finished++);
  life.activate('smile', 'toggle', 3.5, () => finished++);
  assert.equal(applied.at(-1), baseline); assert.equal(finished, 2);
  life.activate('sad', 'timed', 2, () => finished++); life.destroy(); callbacks[2]();
  assert.equal(finished, 2); assert.equal(applied.at(-1), 'sad');
});


test('event expressions persist until explicit reset and cannot be cleared by a superseded timer', () => {
  const applied: Array<string | null> = [], callbacks: Array<() => void> = [];
  const life = new ExpressionLifecycle(id => applied.push(id), () => 'default', callback => { callbacks.push(callback); return callbacks.length as unknown as ReturnType<typeof setTimeout>; }, () => {});
  life.activate('smile', 'timed', 1, () => {});
  life.activate('thinking', 'event', 1, () => {});
  callbacks[0](); assert.equal(applied.at(-1), 'thinking'); assert.equal(callbacks.length, 1);
  life.reset(); assert.equal(applied.at(-1), 'default');
  assert.equal(sanitizeActionProfile({ expressionPolicies: { 'mood:analyzing': { mode: 'event' }, resource: { mode: 'event' } } }).expressionPolicies['mood:analyzing'].mode, 'event');
  assert.equal(sanitizeActionProfile({ expressionPolicies: { resource: { mode: 'event' } } }).expressionPolicies.resource.mode, 'timed');
});
test('hit feedback uses the same winning region and disabled resolution as actual dispatch', () => {
  const profile = emptyActionProfile();
  profile.hotspots = [{ id: 'top', name: 'Top', x: 0, y: 0, width: 1, height: 1 }, { id: 'under', name: 'Under', x: 0, y: 0, width: 1, height: 1 }];
  profile.bindings['zone:top'] = { mode: 'disabled' };
  assert.deepEqual(resolvePointerTarget(profile, { x: .5, y: .5 }, ['Body'], caps), { target: 'zone:top', resolution: { status: 'disabled' } });
  profile.hotspots = [];
  assert.equal(resolvePointerTarget(profile, { x: .5, y: .5 }, ['Body'], caps).target, 'area:Body');
  assert.equal(resolvePointerTarget(profile, { x: .5, y: .5 }, [], caps).target, null);
});
test('default keyboard provenance follows user body overrides and disabled bindings', () => {
  const profile = emptyActionProfile(); profile.bindings['area:Body'] = { mode: 'manual', actionId: caps.actions[0].id };
  let uses = effectiveResourceUses(profile, caps);
  assert.equal(uses.find(use => use.target === 'key:Enter')?.source, 'custom');
  assert.equal(uses.find(use => use.target === 'area:Body')?.source, 'custom');
  profile.bindings['area:Body'] = { mode: 'disabled' }; uses = effectiveResourceUses(profile, caps);
  assert.equal(uses.find(use => use.target === 'area:Body')?.source, 'custom');
  assert.equal(effectiveResourceUses(emptyActionProfile(), caps).find(use => use.target === 'area:Body')?.source, 'matched');
});

test('save counts compare fields and ordered lists without counting JSON formatting', () => {
  assert.equal(countSettingChanges({ a: 1, b: { name: 'old', ids: ['a'] } }, { b: { name: 'new', ids: ['a', 'b'] }, a: 1 }), 2);
  assert.equal(countSettingChanges({ a: 1, b: 2 }, { b: 2, a: 1 }), 0);
});

test('large directories search all resources while mounting only a bounded page', () => {
  const large = capabilitiesFromManifest({ FileReferences: { Motions: { Idle: Array.from({ length: 5000 }, (_, index) => ({ File: `motion-${index}.json` })) } } });
  const profile = emptyActionProfile(), uses = indexResourceUses(effectiveResourceUses(profile, large));
  const filtered = filterResources(large.actions, profile, uses, 'motion-4999.json', 'motion', 'idle');
  assert.equal(filtered.length, 1); assert.equal(filtered[0].index, 4999);
  assert.equal(filterResources(large.actions, profile, uses, '', 'all', 'unused').length, 0);
  const all = filterResources(large.actions, profile, uses, '', 'all', 'all');
  assert.equal(all.length, 5000); assert.equal(all.slice(0, RESOURCE_PAGE_SIZE).length, 50);
  profile.aliases[large.actions[4999].id] = 'Custom alias';
  assert.equal(filterResources(large.actions, profile, uses, 'custom alias', 'all', 'all')[0].index, 4999);
});
