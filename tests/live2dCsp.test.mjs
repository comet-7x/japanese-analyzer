import assert from 'node:assert/strict';
import test from 'node:test';

test('Pixi syncs real uniforms with string code generation disabled', async () => {
  assert.throws(() => new Function('return 1'), EvalError);
  const { WebGLRenderer, GlUniformGroupSystem, UniformGroup } = await import('pixi.js');
  const renderer = Object.create(WebGLRenderer.prototype);
  assert.throws(() => renderer._unsafeEvalCheck(), /unsafe-eval/);
  await import('pixi.js/unsafe-eval');
  assert.doesNotThrow(() => renderer._unsafeEvalCheck());
  const group = new UniformGroup({ uOpacity: { value: .75, type: 'f32' } });
  const system = Object.create(GlUniformGroupSystem.prototype);
  const sync = system._generateUniformsSync(group, { uOpacity: {} });
  const calls = [];
  sync({ uOpacity: { value: 0, location: 'opacity' } }, group.uniforms,
    { gl: { uniform1f: (...args) => calls.push(args) } });
  assert.deepEqual(calls, [['opacity', .75]]);
});
