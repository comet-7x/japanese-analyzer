import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import ts from 'typescript';
import { createTranslator, LOCALES } from '../app/i18n';
import { messages } from '../app/i18n/messages';
import { capabilitiesFromManifest, actionId } from '../app/plugins/live2d/capabilities';
import { ActionCommandGate, actionName, emptyActionProfile, sanitizeActionProfile, resolvePointerAction,
  resolveActionBinding, resolveShortcutAction, shortcutFromEvent, isActionShortcut, removeActionHotspot } from '../app/plugins/live2d/actionProfile';
import { actionGroupLabel, defaultActionName, hitAreaLabel } from '../app/plugins/live2d/actionLabels';
import { intersectScrollBounds } from '../app/plugins/live2d/scrollBounds';
import { sanitizeLive2DSettings, selectLive2DModel, updateLive2DModelConfig, removeLive2DModelConfig } from '../app/plugins/live2d/settings';

const manifest = { HitAreas: [{ Id: 'BodyMesh', Name: 'Body' }, { Id: 'HeadMesh', Name: 'Head' }], FileReferences: {
  Motions: { Idle: [{ File: 'm01.motion3.json' }, { File: 'm02.motion3.json' }], TapBody: [{ File: 'm03.motion3.json' }], TapHead: [{ File: 'm04.motion3.json' }] },
  Expressions: [{ Name: '01', File: '01.exp3.json' }, { Name: '01', File: '02.exp3.json' }],
} };
const caps = capabilitiesFromManifest(manifest);
const action = caps.actions[1];
const body = caps.actions.find(item => item.group === 'TapBody')!;
const head = caps.actions.find(item => item.group === 'TapHead')!;
const profile = () => ({ ...emptyActionProfile(), aliases: { [action.id]: '摸头也可以用待机动作' },
  bindings: { 'zone:head': { mode: 'manual' as const, actionId: action.id } },
  hotspots: [{ id: 'head', name: '头部', part: 'head' as const, x: .3, y: .1, width: .4, height: .25 }] });

test('all actions have stable, distinct identities including duplicate expression names and indexed motions', () => {
  assert.equal(caps.actions.length, 6);
  assert.equal(new Set(caps.actions.map(item => item.id)).size, 6);
  assert.equal(action.index, 1);
  assert.equal(action.file, 'm02.motion3.json');
  const customized = profile();
  assert.equal(actionName(action, customized), '摸头也可以用待机动作');
  assert.equal(actionName(body, customized), '身体互动 1');
  assert.equal(capabilitiesFromManifest(manifest).actions[1].id, action.id);
  assert.notEqual(actionId('motion', 'a,b', 1, 'c'), actionId('motion', 'a', 1, 'b,c'));
  assert.equal(actionId('motion', 'Idle', 1, 'a\\b'), actionId('motion', 'Idle', 1, 'a/b'));
});

test('readable resource labels preserve aliases and original resource identities', () => {
  assert.equal(actionName(action), '自然待机 2');
  assert.equal(actionName(head), '头部互动 1');
  assert.equal(actionGroupLabel('TapBody'), '身体互动');
  assert.equal(actionGroupLabel('unrecognized', 3), '自定义动作组 3');
  assert.equal(defaultActionName({ ...body, group: 'unrecognized' }, 4), '自定义动作 4');
  assert.equal(defaultActionName(caps.actions[4], 5), '自定义表情 5');
  assert.equal(hitAreaLabel('Body'), '身体区域');
  assert.equal(body.group, 'TapBody');
  assert.equal(body.name, 'TapBody · 1');
  assert.equal(actionName(action, profile()), '摸头也可以用待机动作');
});

test('virtual character UI and diagnostic templates have all supported dictionary entries', () => {
  const directory = new URL('../app/plugins/live2d/', import.meta.url);
  for (const filename of readdirSync(directory).filter(name => /\.tsx?$/.test(name))) {
    const tree = ts.createSourceFile(filename, readFileSync(new URL(filename, directory), 'utf8'), ts.ScriptTarget.Latest, true,
      filename.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const check = (key: string) => {
      if (!/[\u3400-\u9fff]/u.test(key)) return;
      assert.ok(Object.hasOwn(messages, key), `${filename}: missing dictionary key ${key}`);
      const entry = messages[key as keyof typeof messages];
      for (const locale of LOCALES.filter(value => value !== 'zh-CN')) {
        assert.ok(entry[locale]?.trim(), `${key}: missing ${locale}`);
        assert.deepEqual(entry[locale].match(/\{\d+\}/g)?.sort() ?? [], key.match(/\{\d+\}/g)?.sort() ?? []);
      }
    };
    const walk = (node: ts.Node) => {
      if (ts.isStringLiteral(node)) check(node.text);
      if (ts.isJsxText(node)) assert.doesNotMatch(node.text, /[\u3400-\u9fff]/u, `${filename}: untranslated JSX text`);
      if (ts.isTemplateExpression(node)) {
        const parts = [node.head.text, ...node.templateSpans.map(span => span.literal.text)];
        check(parts.map((part, index) => part + (index < parts.length - 1 ? `{${index}}` : '')).join(''));
      }
      ts.forEachChild(node, walk);
    };
    walk(tree);
  }
  for (const [locale, idle, touch] of [['zh-TW', '自然待機 2', '身體互動 1'], ['en', 'Natural idle 2', 'Body interaction 1'], ['ko', '자연스러운 대기 2', '몸 상호작용 1']] as const) {
    const t = createTranslator(locale);
    assert.equal(actionName(action, undefined, 2, t), idle);
    assert.equal(actionName(body, undefined, 3, t), touch);
    assert.equal(actionName(action, profile(), 2, t), '摸头也可以用待机动作', 'custom aliases are user content');
    assert.notEqual(hitAreaLabel('Body', t), '身体区域');
  }
});

test('deleting any hotspot clears its binding and preserves other regions and shortcuts', () => {
  const original = profile();
  const second = { ...original.hotspots[0], id: 'body', name: '身体' };
  const draft = { ...original, hotspots: [...original.hotspots, second], bindings: { ...original.bindings,
    'zone:body': { mode: 'manual' as const, actionId: body.id }, 'key:A': { mode: 'manual' as const, actionId: head.id } } };
  const removed = removeActionHotspot(draft, 'head');
  assert.deepEqual(removed.hotspots, [second]);
  assert.equal(removed.bindings['zone:head'], undefined);
  assert.deepEqual(removed.bindings['zone:body'], draft.bindings['zone:body']);
  assert.deepEqual(removed.bindings['key:A'], draft.bindings['key:A']);
  assert.equal(draft.hotspots.length, 2, 'deletion must not mutate the draft being replaced');
  const empty = removeActionHotspot(removed, 'body');
  assert.deepEqual(empty.hotspots, []);
  assert.deepEqual(Object.keys(empty.bindings), ['key:A']);
});

test('portal scrollbar bounds respect nested panel clipping and viewport edges', () => {
  const target = { left: 400, top: 300, right: 650, bottom: 1200 };
  const bounds = intersectScrollBounds(target, [
    { left: 0, top: 0, right: 1400, bottom: 900 },
    { left: 350, top: 150, right: 1300, bottom: 820 },
    { left: 450, top: 250, right: 1250, bottom: 800 },
  ]);
  assert.deepEqual(bounds, { left: 450, top: 300, right: 650, bottom: 800 });
  const hidden = intersectScrollBounds(target, [{ left: 0, top: 0, right: 1400, bottom: 200 }]);
  assert.ok(hidden.bottom <= hidden.top, 'fully clipped lists must not produce a visible rail');
  const domRectLike = Object.create({ left: 400, top: 300, right: 650, bottom: 1200 });
  assert.deepEqual(intersectScrollBounds(domRectLike, [{ left: 0, top: 0, right: 1400, bottom: 800 }]),
    { left: 400, top: 300, right: 650, bottom: 800 }, 'DOMRect coordinates are inherited properties');
});

test('interaction drafts survive sanitization, scale edits, model switches and serialization without cross-model leakage', () => {
  let settings = sanitizeLive2DSettings({ enabled: true, modelId: 'a', scale: 1.2,
    modelConfigs: { a: { scale: 1.2, sensitivity: 1.4, interaction: profile() } } });
  settings = updateLive2DModelConfig(settings, 'a', { scale: 2 });
  assert.deepEqual(settings.modelConfigs.a.interaction, profile());
  settings = selectLive2DModel(settings, 'b');
  assert.equal(settings.modelConfigs.b?.interaction, undefined);
  settings = updateLive2DModelConfig(settings, 'b', { interaction: emptyActionProfile() });
  settings = sanitizeLive2DSettings(JSON.parse(JSON.stringify(selectLive2DModel(settings, 'a'))));
  assert.equal(settings.scale, 2);
  assert.deepEqual(settings.modelConfigs.a.interaction, profile());
  assert.equal(updateLive2DModelConfig(settings, 'b', { interaction: emptyActionProfile() }), settings, 'late updates from another model are ignored');
  const deleted = removeLive2DModelConfig(settings, 'a');
  assert.equal(deleted.modelConfigs.a, undefined);
  assert.deepEqual(deleted.modelConfigs.b.interaction, emptyActionProfile());
});

test('custom zones precede native areas, overlap order is explicit, and disabled or missing references block fallback', () => {
  const custom = profile();
  assert.deepEqual(resolvePointerAction(custom, { x: .5, y: .2 }, ['Body', 'Head'], caps), { status: 'action', action });
  assert.deepEqual(resolvePointerAction(custom, { x: .5, y: .8 }, ['Body'], caps), { status: 'action', action: body });
  assert.deepEqual(resolvePointerAction(custom, { x: .1, y: .1 }, [], caps), { status: 'none' });
  const disabled = sanitizeActionProfile({ ...custom, bindings: { 'zone:head': { mode: 'disabled' } } });
  assert.deepEqual(resolvePointerAction(disabled, { x: .5, y: .2 }, ['Body'], caps), { status: 'disabled' });
  disabled.hotspots.push({ ...custom.hotspots[0], id: 'underlying' });
  disabled.bindings['zone:underlying'] = { mode: 'manual', actionId: body.id };
  assert.deepEqual(resolvePointerAction(disabled, { x: .5, y: .2 }, ['Body'], caps), { status: 'disabled' });
  disabled.hotspots.reverse();
  assert.deepEqual(resolvePointerAction(disabled, { x: .5, y: .2 }, ['Body'], caps), { status: 'action', action: body });
  assert.deepEqual(resolveActionBinding({ ...custom, bindings: { 'area:Head': { mode: 'manual', actionId: 'deleted' } } }, 'area:Head', caps, head), { status: 'missing' });
  assert.deepEqual(resolvePointerAction(undefined, { x: .5, y: .2 }, ['Body', 'Head'], caps), { status: 'action', action: head });
});

test('keyboard defaults use the same bindings, custom keys override individually, and reserved chords are rejected', () => {
  const custom = profile();
  assert.deepEqual(resolveShortcutAction(custom, 'Shift+Enter', caps), { status: 'action', action });
  assert.deepEqual(resolveShortcutAction(custom, 'Enter', caps), { status: 'action', action: body });
  custom.bindings = { ...custom.bindings, 'key:Enter': { mode: 'disabled' }, 'key:A': { mode: 'manual', actionId: action.id } } as typeof custom.bindings;
  assert.deepEqual(resolveShortcutAction(custom, 'Enter', caps), { status: 'disabled' });
  assert.deepEqual(resolveShortcutAction(custom, 'A', caps), { status: 'action', action });
  assert.equal(resolveShortcutAction(custom, 'B', caps), null);
  const base = { key: 'a', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false };
  assert.equal(shortcutFromEvent(base), 'A');
  assert.equal(shortcutFromEvent({ ...base, shiftKey: true }), 'Shift+A');
  for (const patch of [{ key: 'Tab' }, { key: 'ArrowDown' }, { key: 'Escape' }, { ctrlKey: true }, { metaKey: true }, { altKey: true }]) assert.equal(shortcutFromEvent({ ...base, ...patch }), null);
  assert.equal(isActionShortcut('Shift+Enter'), true);
  assert.equal(isActionShortcut('Ctrl+R'), false);
});

test('profile parsing rejects corrupt geometry, duplicates and prototype keys while preserving missing references for repair', () => {
  const raw = JSON.parse('{"aliases":{"__proto__":"bad"},"bindings":{"area:Head":{"mode":"manual","actionId":"missing-resource"}},"hotspots":[]}');
  raw.hotspots = [{ id: 'bad', x: NaN, y: 0, width: 1, height: 1 }, { id: 'ok', name: 'valid', x: -.1, y: .8, width: 2, height: 2 }, { id: 'ok', x: 0, y: 0, width: 1, height: 1 }];
  const parsed = sanitizeActionProfile(raw);
  assert.equal(Object.hasOwn(parsed.aliases, '__proto__'), false);
  assert.equal(parsed.hotspots.length, 1);
  assert.equal(parsed.hotspots[0].x, 0);
  assert.ok(Math.abs(parsed.hotspots[0].height - .2) < 1e-10);
  assert.deepEqual(parsed.bindings['area:Head'], { mode: 'manual', actionId: 'missing-resource' });
});

test('late preview loads cannot start after replacement, stop, model change or disposal', async () => {
  const gate = new ActionCommandGate();
  let finish!: (value: boolean) => void;
  const started: string[] = [];
  const first = gate.run(() => new Promise(resolve => { finish = resolve; }), async () => { started.push('old'); return true; });
  assert.equal(await gate.run(async () => true, async () => { started.push('new'); return true; }), true);
  finish(true);
  assert.equal(await first, false);
  const stopped = gate.run(() => new Promise(resolve => { finish = resolve; }), async () => { started.push('stopped'); return true; });
  gate.cancel(); finish(true);
  assert.equal(await stopped, false);
  assert.equal(await gate.run(async () => false, async () => { started.push('failed'); return true; }), false);
  assert.deepEqual(started, ['new']);
});
