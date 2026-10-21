import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Live2DRuntime, type RenderMode } from '../app/plugins/live2d/runtime';
import { ExpressionQueue, moodForAnalysis, smoothValue } from '../app/plugins/live2d/companion';
import { sanitizeLive2DSettings, selectLive2DModel, updateLive2DModelConfig, removeLive2DModelConfig } from '../app/plugins/live2d/settings';
import { scaleFromWheel } from '../app/plugins/live2d/scale';
import { placeBubble } from '../app/plugins/live2d/bubble';
import { decodeAudioDataCompat, getSpeechEnvelope } from '../app/plugins/live2d/audioEnvelope';
import { ensureMaskResolution, planRenderQuality } from '../app/plugins/live2d/renderQuality';
import { guardStageBackgroundSelection } from '../app/plugins/live2d/selectionGuard';
import { areasForPart, isCharacterTap, resolveInteractionMotion } from '../app/plugins/live2d/interaction';
import { capabilitiesFromManifest, detectLive2DCapabilities, resolveCapabilityInteraction } from '../app/plugins/live2d/capabilities';
import { visibleAlphaBounds, visibleBaseCenter } from '../app/plugins/live2d/visualBounds';

test('capsule anchor follows the visible standing base rather than transparent margins, hair or raised arms', () => {
  const width = 100, height = 100, pixels = new Uint8ClampedArray(width * height * 4);
  const paint = (left: number, top: number, right: number, bottom: number, alpha = 255) => {
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) pixels[(y * width + x) * 4 + 3] = alpha;
  };
  paint(20, 10, 60, 90); // Body and feet have a centre of 40, but the canvas centre is 50.
  paint(0, 15, 80, 40); // Hair and arms must not move the standing anchor.
  paint(0, 0, 100, 1, 10); // Ignore faint antialiasing / glow.
  assert.deepEqual(visibleAlphaBounds(pixels, width, height), { left: 0, top: 10, right: 80, bottom: 90 });
  assert.equal(visibleBaseCenter(pixels, width, height), .4);
  paint(80, 15, 100, 40);
  assert.equal(visibleBaseCenter(pixels, width, height), .4, 'asymmetric accessories do not skew the anchor');
  assert.equal(visibleBaseCenter(new Uint8Array(400), 10, 10), null);
  assert.equal(visibleBaseCenter([], 10, 10), null);
});

test('capability discovery inventories all resources and binds declared interactions and semantic moods', () => {
  const report = detectLive2DCapabilities({
    areas: ['Head', 'Body', '左手', 'Wing', 'Head'],
    motions: { Idle: [{}, {}], TapHead: [{}], TapBody: [{}], TapLeftHand: [{}], TapWing: [{}], Think: [{}], Success: [{}], mystery01: [{}], Empty: [] },
    expressions: ['smile', 'exp_doubt', 'smile'],
  });
  assert.equal(report.interactions.length, 4);
  assert.equal(report.interactions.find(item => item.area === '左手')?.motion, 'TapLeftHand');
  assert.equal(report.interactions.find(item => item.area === 'Wing')?.motion, 'TapWing');
  assert.equal(report.idle, 'Idle');
  assert.deepEqual(report.moods.success, { expression: 'smile', motion: 'Success' });
  assert.equal(report.moods.analyzing.motion, 'Think');
  assert.equal(report.moods.error.expression, 'exp_doubt');
  assert.deepEqual(report.unboundMotionGroups, ['mystery01']);
  assert.equal(report.motionGroups.reduce((sum, group) => sum + group.count, 0), 9);
  assert.deepEqual(report.expressions, ['smile', 'exp_doubt']);
  assert.equal(resolveCapabilityInteraction(['Body', 'Head'], report), 'TapHead');
  assert.equal(resolveCapabilityInteraction([], report), null);
});

test('capabilities are rebuilt per model and cannot enable an action without its required hit area', () => {
  const full = detectLive2DCapabilities({ areas: ['Head', 'Body'], motions: { TapHead: [{}], TapBody: [{}] }, expressions: ['happy'] });
  const limited = detectLive2DCapabilities({ areas: ['Body'], motions: { Idle: [{}], TapHead: [{}], motion_01: [{}] }, expressions: ['expression_01'] });
  assert.equal(resolveCapabilityInteraction(['Head'], full), 'TapHead');
  assert.equal(resolveCapabilityInteraction(['Head', 'Body'], limited), null);
  assert.equal(limited.interactions[0].motion, null);
  assert.deepEqual(limited.unboundMotionGroups, ['TapHead', 'motion_01']);
  assert.deepEqual(limited.moods.success, { expression: null, motion: null }, 'numbered assets are not guessed to be emotions');
  assert.equal(resolveCapabilityInteraction(['Head'], full), 'TapHead', 'detecting another model cannot mutate an existing report');
});

test('manifest detection ignores malformed declarations and inventories valid custom resources', () => {
  const report = capabilitiesFromManifest({ HitAreas: [{ Name: 'Head', Id: '' }, { Name: 'Body', Id: 'HitBody' }, { Name: 4, Id: 'x' }],
    FileReferences: { Motions: { Idle: [{ File: 'idle.motion3.json' }], TapBody: [{ File: 'body.motion3.json' }], broken: [null] },
      Expressions: [{ Name: 'happy', File: 'happy.exp3.json' }, null, { Name: 'missing-file' }] } });
  assert.deepEqual(report.interactions, [{ area: 'Body', part: 'body', motion: 'TapBody' }]);
  assert.deepEqual(report.expressions, ['happy']);
  assert.deepEqual(report.motionGroups.map(group => group.name), ['Idle', 'TapBody']);
  const localized = detectLive2DCapabilities({ areas: ['頭'], motions: { 頭タップ: [{}] }, expressions: ['笑顔'] });
  assert.equal(localized.interactions[0].motion, '頭タップ');
  assert.equal(localized.moods.success.expression, '笑顔');
  assert.deepEqual(capabilitiesFromManifest(null).motionGroups, []);
});

test('part interactions match declared motion groups without confusing head, body, blank space or Idle', () => {
  const definitions = { Idle: [{}], TapBody: [{}], TapHead: [{}], TapLeftArm: [{}], TapFace: [] };
  assert.equal(resolveInteractionMotion(['Head'], definitions), 'TapHead');
  assert.equal(resolveInteractionMotion(['Body'], definitions), 'TapBody');
  assert.equal(resolveInteractionMotion(['Body', 'HitAreaHead'], definitions), 'TapHead');
  assert.equal(resolveInteractionMotion(['Hit_Area_LeftArm'], definitions), 'TapLeftArm');
  assert.equal(resolveInteractionMotion([], definitions), null);
  assert.equal(resolveInteractionMotion(['Head'], { Idle: [{}], TapBody: [{}] }), null);
  assert.equal(resolveInteractionMotion(['Head', 'Body'], { TapBody: [{}] }), null, 'an overlapping body cannot replace a missing head action');
  assert.equal(resolveInteractionMotion(['Body'], { TapBody: [], Idle: [{}] }), null);
  assert.equal(resolveInteractionMotion(['Custom'], { Touch: [{}] }), 'Touch');
  assert.deepEqual(areasForPart(['Body', 'HitAreaHead', 'Face'], 'head'), ['HitAreaHead', 'Face']);
});

test('character tap requires a paired primary release and never fires for a drag, cancellation or secondary pointer', () => {
  const start = { pointerId: 1, startX: 100, startY: 200, moved: false };
  const end = { type: 'pointerup', pointerId: 1, clientX: 102, clientY: 202, button: 0, isPrimary: true };
  assert.equal(isCharacterTap(start, end), true);
  assert.equal(isCharacterTap(start, { ...end, clientX: 105, clientY: 200 }), false);
  assert.equal(isCharacterTap({ ...start, moved: true }, end), false, 'moving out and back still counts as a drag');
  for (const patch of [{ type: 'pointercancel' }, { type: 'lostpointercapture' }, { pointerId: 2 }, { button: 2 }, { isPrimary: false }]) {
    assert.equal(isCharacterTap(start, { ...end, ...patch }), false);
  }
});

test('stage selection guard blocks nearest-line selection on blank space and preserves real reading targets', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'Element');
  let control = false;
  let textRects: Array<{ left: number; right: number; top: number; bottom: number }> = [];
  class TestElement {
    closest() { return control ? this : null; }
    childNodes = [{ nodeType: 3, textContent: 'A line of Japanese text' }];
    ownerDocument = { createRange: () => ({ selectNodeContents() {}, getClientRects: () => textRects, detach() {} }) };
  }
  Object.defineProperty(globalThis, 'Element', { configurable: true, value: TestElement });
  try {
    const target = new TestElement();
    const container = { getBoundingClientRect: () => ({ left: 0, top: 0, right: 300, bottom: 500 }) } as HTMLElement;
    const guarded = (patch: Record<string, unknown> = {}) => {
      let prevented = false;
      guardStageBackgroundSelection({ target, clientX: 150, clientY: 250, button: 0, cancelable: true,
        shiftKey: false, preventDefault: () => { prevented = true; }, ...patch } as unknown as MouseEvent, container);
      return prevented;
    };
    assert.equal(guarded(), true, 'a double click on blank stage space must not select the closest line');
    control = true;
    assert.equal(guarded(), false, 'underlying buttons, inputs and links remain usable in reading mode');
    control = false;
    textRects = [{ left: 120, right: 260, top: 240, bottom: 270 }];
    assert.equal(guarded(), false, 'actual text under the character remains selectable');
    textRects = [{ left: 350, right: 650, top: 240, bottom: 270 }];
    assert.equal(guarded(), true, 'nearby text outside the point is not a reading target');
    assert.equal(guarded({ clientX: 350 }), false, 'clicks outside the stage are untouched');
    assert.equal(guarded({ pointerType: 'touch' }), false, 'native touch scrolling is untouched');
    assert.equal(guarded({ button: 2 }), false);
    assert.equal(guarded({ shiftKey: true }), false, 'explicit range extension remains available');
  } finally {
    if (original) Object.defineProperty(globalThis, 'Element', original);
    else Reflect.deleteProperty(globalThis, 'Element');
  }
});

test('mask upgrades rebind the recreated manager before rendering and do not reallocate on every tick', () => {
  const gl = {} as WebGLRenderingContext;
  let size = 256;
  let context: WebGLRenderingContext | null = gl;
  let allocations = 0;
  const renderer = {
    getClippingMaskBufferSize: () => size,
    setClippingMaskBufferSize: (next: number) => { size = next; context = null; allocations++; },
    startUp: (next: WebGLRenderingContext) => { context = next; },
  };
  ensureMaskResolution(renderer, 512, gl);
  assert.equal(context, gl, 'the first draw must have a GL context');
  ensureMaskResolution(renderer, 1024, gl);
  assert.equal(context, gl, 'live resizing must also restore the new manager context');
  ensureMaskResolution(renderer, 512, gl);
  ensureMaskResolution(renderer, 1024, gl);
  assert.equal(allocations, 2, 'settled/slightly smaller stages must reuse their mask buffer');
});

test('render quality follows display density and stage growth without losing fractional CSS sizes', () => {
  const small = planRenderQuality(191.3984375, 313.1953125, 2);
  const large = planRenderQuality(550, 685, 2);
  assert.equal(small.width, 191.3984375);
  assert.equal(small.resolution, 2);
  assert.equal(large.resolution, 2);
  assert.equal(large.pixelWidth, 1100);
  assert.equal(large.pixelHeight, 1370);
  assert.equal(small.maskSize, 512);
  assert.equal(large.maskSize, 1024);
  const retina = planRenderQuality(550, 685, 3);
  assert.equal(retina.resolution, 3, '3x screens must not retain the previous fixed 2x cap');
  assert.equal(retina.pixelWidth, 1650);
  assert.equal(planRenderQuality(550, 685, 1.25).resolution, 1.25, 'browser zoom is not rounded to an integer');
});

test('render quality respects GPU edge and pixel budgets at high density', () => {
  const huge = planRenderQuality(2000, 1500, 4);
  assert.ok(huge.resolution < 4);
  assert.ok(huge.pixelWidth * huge.pixelHeight <= 6_010_000);
  assert.ok(huge.pixelWidth <= 4096 && huge.pixelHeight <= 4096);
  const limited = planRenderQuality(550, 685, 4, 1024);
  assert.ok(limited.pixelWidth <= 1024 && limited.pixelHeight <= 1024);
  assert.equal(planRenderQuality(0, NaN, Infinity).resolution, 1);
});

test('runtime idles, holds long activities, prioritizes visibility, wakes, and cancels deadlines', () => {
  let now = 0;
  let nextId = 0;
  const timers = new Map<number, () => void>();
  const modes: RenderMode[] = [];
  const advance = (ms: number) => {
    now += ms;
    const queued = [...timers.values()];
    timers.clear();
    queued.forEach(callback => callback());
  };
  const runtime = new Live2DRuntime(mode => modes.push(mode), false, () => now,
    callback => { const id = ++nextId; timers.set(id, callback); return id as unknown as ReturnType<typeof setTimeout>; },
    timer => { timers.delete(timer as unknown as number); });
  advance(8000);
  assert.deepEqual(modes, ['active', 'idle']);
  runtime.setBusy(true);
  advance(60000);
  assert.equal(modes.at(-1), 'active', 'a long user motion or a speech pause must not freeze');
  runtime.setVisible(false);
  runtime.wake();
  assert.equal(modes.at(-1), 'paused', 'background events cannot restart rendering');
  runtime.setBusy(false);
  runtime.setVisible(true);
  assert.equal(modes.at(-1), 'active');
  advance(8000);
  runtime.setPauseWhenIdle(true);
  assert.equal(modes.at(-1), 'paused');
  runtime.wake();
  assert.equal(modes.at(-1), 'active');
  runtime.destroy();
  assert.equal(timers.size, 0);
  const count = modes.length;
  runtime.wake();
  assert.equal(modes.length, count);
});

test('model preferences restore independently without sanitization overriding edits', () => {
  let settings = sanitizeLive2DSettings({ enabled: true, modelId: 'a', scale: 1.2, sensitivity: 1.5 });
  settings = selectLive2DModel(settings, 'b');
  assert.equal(settings.scale, 1);
  settings = updateLive2DModelConfig(settings, 'b', { scale: 2.4, sensitivity: 0.6 });
  settings = selectLive2DModel(settings, 'a');
  assert.equal(settings.scale, 1.2);
  assert.equal(settings.sensitivity, 1.5);
  settings = updateLive2DModelConfig(settings, 'a', { scale: 1.8 });
  assert.equal(sanitizeLive2DSettings({ ...settings, scale: 2 }).scale, 2);
  assert.equal(updateLive2DModelConfig(settings, 'b', { scale: 0.4 }), settings, 'late writes cannot affect a different model');
  settings = selectLive2DModel(settings, 'b');
  assert.equal(settings.scale, 2.4);
  assert.equal(settings.sensitivity, 0.6);
  settings = removeLive2DModelConfig(settings, 'a');
  assert.equal(settings.modelConfigs.a, undefined);
  settings = removeLive2DModelConfig(settings, 'b');
  assert.equal(settings.modelId, null);
  assert.deepEqual(settings.modelConfigs, {});
  assert.equal(sanitizeLive2DSettings({ scale: Infinity }).scale, 1);
  assert.equal(sanitizeLive2DSettings({ scale: -20 }).scale, 0.4);
  assert.equal(sanitizeLive2DSettings({ scale: 20 }).scale, 2.5);
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

test('late expression loads cannot resurrect a mood after reset or destruction', async () => {
  const load = deferred();
  const applied: string[] = [];
  const queue = new ExpressionQueue(() => load.promise, async id => { applied.push(id); },
    () => { applied.push('idle'); }, () => {});
  queue.set('happy');
  queue.set(null);
  load.resolve();
  await flush();
  assert.deepEqual(applied, ['idle']);
  const pending = deferred();
  const destroyed = new ExpressionQueue(() => pending.promise, async id => { applied.push(id); }, () => {}, () => {});
  destroyed.set('sad'); destroyed.destroy(); pending.resolve();
  await flush();
  assert.deepEqual(applied, ['idle']);
});

test('an in-flight expression application is reconciled to the latest mood', async () => {
  const applying = deferred();
  const applied: string[] = [];
  const queue = new ExpressionQueue(async () => {}, async id => { await applying.promise; applied.push(id); },
    () => { applied.push('idle'); }, () => {});
  queue.set('happy');
  await flush();
  queue.set(null);
  applying.resolve();
  await flush();
  assert.deepEqual(applied, ['happy', 'idle']);
});

test('moods expire from the event timestamp and smoothing is independent of frame rate', () => {
  const event = { requestId: 1, phase: 'succeeded' as const, at: 1000 };
  assert.equal(moodForAnalysis(event, 4499), 'success');
  assert.equal(moodForAnalysis(event, 4500), 'idle');
  assert.equal(moodForAnalysis({ ...event, phase: 'cancelled' }, 1100), 'idle');
  assert.equal(moodForAnalysis(null, 1100), 'idle');
  let fast = 0; let slow = 0;
  for (let i = 0; i < 60; i++) fast = smoothValue(fast, 1, 1 / 60);
  for (let i = 0; i < 15; i++) slow = smoothValue(slow, 1, 1 / 15);
  assert.ok(Math.abs(fast - slow) < 1e-10);
});

test('wheel scaling preserves tiny trackpad deltas, accumulates, and normalizes units', () => {
  assert.ok(scaleFromWheel(1, -0.1, 0, 800) > 1);
  assert.equal(scaleFromWheel(1, 1, 1, 800), scaleFromWheel(1, 16, 0, 800));
  assert.equal(scaleFromWheel(1, 1, 2, 800), scaleFromWheel(1, 800, 0, 800));
  let scale = 1;
  for (let i = 0; i < 100; i++) scale = scaleFromWheel(scale, -0.1, 0, 800);
  assert.ok(Math.abs(scale - Math.exp(0.03)) < 1e-10);
  assert.equal(scaleFromWheel(1, -10000, 0, 800), 2.5);
  assert.equal(scaleFromWheel(1, 10000, 0, 800), 0.4);
});

test('bubbles remain in a narrow visual viewport and tails follow the anchor', () => {
  const viewport = { x: 20, y: 30, width: 320, height: 480 };
  for (const x of [20, 250]) for (const y of [30, 420]) {
    const result = placeBubble({ x, y, width: 90, height: 60 }, { width: 260, height: 80 }, viewport);
    assert.ok(result.x >= 28 && result.x + 260 <= 332);
    assert.ok(result.y >= 38 && result.y + 80 <= 502);
    assert.ok(result.tail >= 16 && result.tail <= 244);
    assert.equal(result.placement, y === 30 ? 'bottom' : 'top');
  }
  const result = placeBubble({ x: 100, y: 300, width: 100, height: 60 }, { width: 200, height: 80 }, viewport);
  assert.equal(result.x + result.tail, 150);
});

test('audio decoder accepts callback-only, promise-only, and dual completion implementations', async () => {
  const expected = {} as AudioBuffer;
  const callback = { decodeAudioData: (_data: ArrayBuffer, success: (buffer: AudioBuffer) => void) => { success(expected); } };
  const promise = { decodeAudioData: () => Promise.resolve(expected) };
  const dual = { decodeAudioData: (_data: ArrayBuffer, success: (buffer: AudioBuffer) => void) => {
    success(expected); return Promise.reject(new Error('late duplicate failure'));
  } };
  for (const context of [callback, promise, dual]) {
    assert.equal(await decodeAudioDataCompat(context as unknown as BaseAudioContext, new ArrayBuffer(1)), expected);
  }
  await assert.rejects(decodeAudioDataCompat({ decodeAudioData() { throw new Error('format'); } } as unknown as BaseAudioContext, new ArrayBuffer(1)), /format/);
});

test('audio failure closes the realtime fallback and permits retry of the same blob', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  let closed = 0;
  let attempts = 0;
  class Realtime {
    decodeAudioData() { attempts++; return Promise.reject(new Error('unsupported')); }
    async close() { closed++; }
  }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { AudioContext: Realtime } });
  try {
    const blob = new Blob(['invalid']);
    await assert.rejects(getSpeechEnvelope(blob), /unsupported/);
    await assert.rejects(getSpeechEnvelope(blob), /unsupported/);
    assert.equal(attempts, 2);
    assert.equal(closed, 2);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('offline audio decoding is bounded to two jobs and successful blobs are cached', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  let active = 0;
  let maximum = 0;
  let calls = 0;
  const releases: Array<() => void> = [];
  const buffer = { numberOfChannels: 1, sampleRate: 1000,
    getChannelData: () => new Float32Array(40).fill(0.1) } as unknown as AudioBuffer;
  class Offline {
    decodeAudioData() {
      calls++; active++; maximum = Math.max(maximum, active);
      return new Promise<AudioBuffer>(resolve => releases.push(() => { active--; resolve(buffer); }));
    }
  }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { OfflineAudioContext: Offline } });
  try {
    const blobs = [new Blob(['a']), new Blob(['b']), new Blob(['c'])];
    const tasks = blobs.map(getSpeechEnvelope);
    assert.equal(getSpeechEnvelope(blobs[0]), tasks[0]);
    await flush();
    assert.equal(calls, 2);
    releases.shift()!();
    await flush();
    assert.equal(calls, 3);
    releases.splice(0).forEach(release => release());
    const envelopes = await Promise.all(tasks);
    assert.equal(maximum, 2);
    assert.ok(envelopes.every(envelope => envelope.durationSeconds === 0.04));
    assert.equal(getSpeechEnvelope(blobs[0]), tasks[0]);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
