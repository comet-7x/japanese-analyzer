import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { createProfileFromPreset, effectiveCaps, getModelPreferences, normalizeEndpointUrl, PRESETS, sanitizeProfiles, type ProviderProfile } from '../app/lib/aiModels';
import { getProviderIcon, PROVIDER_ICONS } from '../app/lib/providerIcons';
import { loadAISettingsFromStorage, saveAISettingsToStorage, type StorageLike } from '../app/services/api';
import { buildCompletionPayload, ProviderConfigError, resolveProviderConfig } from '../app/api/_utils/providerConfig';
import { POST as analyze } from '../app/api/analyze/route';
import { formatUserFacingError } from '../app/i18n';

class Storage implements StorageLike {
  values = new Map<string, string>();
  getItem = (key: string) => this.values.get(key) ?? null;
  setItem = (key: string, value: string) => { this.values.set(key, value); };
  removeItem = (key: string) => { this.values.delete(key); };
}
const services: ProviderProfile[] = [{
  id: 'provider', name: 'Provider', baseUrl: 'https://model.example/v1', apiKey: 'test',
  models: [
    { id: 'a', name: 'A', model: 'model-a', caps: { thinking: true } },
    { id: 'b', name: 'B', model: 'model-b', caps: { thinking: true }, preferences: { stream: true, thinkingEnabled: false } },
  ],
}];
async function main() {
  for (const preset of PRESETS) {
    const profile = createProfileFromPreset(preset.id)!;
    const another = createProfileFromPreset(preset.id)!;
    assert.notEqual(profile.id, another.id, 'Multiple configurations of the same brand stay independent');
    assert.equal(profile.presetId, preset.id);
    assert.equal(getProviderIcon(profile), PROVIDER_ICONS[preset.id], 'New preset configurations retain their brand logo');
    const presetStorage = new Storage();
    const edited = { ...profile, name: 'Renamed service', baseUrl: 'https://gateway.example/v1', apiKey: 'test' };
    saveAISettingsToStorage(presetStorage, { services: [edited], activeServiceId: profile.id, activeModelId: profile.models[0].id, geminiApiKey: '' });
    const restored = loadAISettingsFromStorage(presetStorage).services[0];
    assert.equal(restored.presetId, preset.id, 'Brand survives saving and reloading');
    assert.equal(getProviderIcon(restored), PROVIDER_ICONS[preset.id], 'Renaming or using a gateway preserves the preset logo');
    assert.equal(getProviderIcon({ id: 'custom-old', name: 'Renamed service', baseUrl: preset.baseUrl }), PROVIDER_ICONS[preset.id], 'Existing saved configurations recover their logo from the official endpoint');
    assert.equal(getProviderIcon({ id: preset.id, name: preset.name }), PROVIDER_ICONS[preset.id], 'Legacy IDs and speech/translation logos remain supported');
  }
  assert.equal(createProfileFromPreset('unknown'), null);
  assert.equal(getProviderIcon(null), undefined);
  for (const baseUrl of ['invalid', 'https://api.openai.com.example/v1', 'https://gateway.example/v1']) {
    assert.equal(getProviderIcon({ id: 'custom', name: 'OpenAI', baseUrl }), undefined, 'Unknown endpoints retain the initial-letter fallback');
  }
  assert.equal(sanitizeProfiles([{ ...services[0], presetId: 'unknown' }])[0].presetId, undefined);
  const volcengine = createProfileFromPreset('volcengine')!;
  assert.equal(volcengine.baseUrl, 'https://ark.cn-beijing.volces.com/api/plan/v3');
  assert.equal(volcengine.models[0].model, 'doubao-seed-2.1-lite');
  assert.equal(normalizeEndpointUrl(volcengine.baseUrl), 'https://ark.cn-beijing.volces.com/api/plan/v3/chat/completions');
  assert.equal(getProviderIcon({ id: 'custom-old', name: 'Volcengine', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3' }), PROVIDER_ICONS.volcengine);

  const storage = new Storage();
  storage.setItem('thinkingEnabled', 'true'); storage.setItem('useStream', 'false');
  storage.setItem('providerSettings', JSON.stringify({ services, activeServiceId: 'provider', activeModelId: 'a' }));
  const loaded = loadAISettingsFromStorage(storage);
  assert.deepEqual(getModelPreferences(loaded.services[0].models[0]), { stream: false, thinkingEnabled: true }, 'Legacy global choices migrate');
  assert.deepEqual(getModelPreferences(loaded.services[0].models[1]), { stream: true, thinkingEnabled: false }, 'Explicit per-model choices win');
  saveAISettingsToStorage(storage, loaded);
  assert.equal(storage.getItem('thinkingEnabled'), null); assert.equal(storage.getItem('useStream'), null);
  const reloaded = loadAISettingsFromStorage(storage);
  assert.deepEqual(reloaded.services, loaded.services, 'Preferences survive saving and reload after global keys are removed');
  saveAISettingsToStorage(storage, { ...reloaded, activeModelId: 'b' });
  const selected = loadAISettingsFromStorage(storage);
  assert.equal(selected.activeModelId, 'b');
  assert.deepEqual(getModelPreferences(selected.services[0].models[0]), { stream: false, thinkingEnabled: true });
  assert.deepEqual(getModelPreferences(selected.services[0].models[1]), { stream: true, thinkingEnabled: false });
  assert.deepEqual(getModelPreferences({ id: 'x', name: 'X', model: 'x', preferences: { thinkingEnabled: true } }), { stream: true, thinkingEnabled: false }, 'Unsupported models never enable reasoning');

  const raw = [{ ...services[0], models: [{ ...services[0].models[0], caps: { contextWindow: 262144, maxOutputTokens: 32000, reasoningEffort: ' high ', thinking: true }, preferences: { stream: false, thinkingEnabled: true } }] }];
  const cleaned = sanitizeProfiles(raw);
  const caps = effectiveCaps(cleaned[0], cleaned[0].models[0]);
  const req = new NextRequest('http://localhost/api/analyze', { headers: { Authorization: 'Bearer test' } });
  const resolved = resolveProviderConfig(req, { baseUrl: services[0].baseUrl, model: 'model-a', caps });
  assert.equal(resolved.caps.contextWindow, 262144);
  assert.equal(resolved.caps.maxOutputTokens, 32000);
  assert.equal(resolved.caps.reasoningEffort, 'high', 'Reasoning effort must survive server normalization');
  const payload = buildCompletionPayload(resolved.caps, { model: 'model-a', max_tokens: 8192, messages: [{ role: 'user', content: '猫' }] }, { enableThinking: true });
  assert.equal(payload.max_tokens, 8192, 'A larger user limit does not inflate a short task budget');
  assert.equal(payload.reasoning_effort, 'high');
  assert.deepEqual(payload.thinking, { type: 'enabled' });
  assert.equal(buildCompletionPayload({ maxOutputTokens: 2000 }, { max_tokens: 8192 }).max_tokens, 2000);
  assert.equal(buildCompletionPayload({ maxOutputTokens: 2000 }, { max_tokens: 60 }).max_tokens, 60);
  assert.equal(buildCompletionPayload({ maxOutputTokens: 2000 }, {}).max_tokens, 2000);
  assert.equal(buildCompletionPayload({}, {}).max_tokens, undefined, 'Absent settings preserve existing provider defaults');
  const tiny = buildCompletionPayload({ contextWindow: 1000 }, { messages: [{ role: 'user', content: '猫' }], max_tokens: 8192 });
  assert.ok(Number(tiny.max_tokens) > 0 && Number(tiny.max_tokens) < 1000);
  assert.throws(() => buildCompletionPayload({ contextWindow: 10 }, { messages: [{ role: 'user', content: '猫' }] }), ProviderConfigError);
  const image = buildCompletionPayload({ contextWindow: 8000, maxOutputTokens: 2000 }, { messages: [{ content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,' + 'A'.repeat(20000) } }] }] });
  assert.equal(image.max_tokens, 2000, 'Image base64 bytes are not treated as text tokens');
  for (const invalid of [-1, 0, 1.5, Infinity, '8192', null]) {
    const sanitized = sanitizeProfiles([{ ...raw[0], models: [{ ...raw[0].models[0], caps: { contextWindow: invalid, maxOutputTokens: invalid }, preferences: { stream: 'false', thinkingEnabled: 1 } }] }]);
    assert.equal(sanitized[0].models[0].caps?.maxOutputTokens, undefined);
    assert.equal(sanitized[0].models[0].caps?.contextWindow, undefined);
    assert.equal(sanitized[0].models[0].preferences, undefined);
    const normalized = resolveProviderConfig(req, { baseUrl: services[0].baseUrl, model: 'a', caps: { maxOutputTokens: invalid, contextWindow: invalid } });
    assert.equal(normalized.caps.maxOutputTokens, undefined);
    assert.equal(normalized.caps.contextWindow, undefined);
  }
  assert.match(formatUserFacingError('内容超过当前模型的上下文窗口，请缩短内容或调大模型配置。', 'en'), /context window/);

  const originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    for (const stream of [true, false]) {
      globalThis.fetch = async (_input, init) => {
        calls++;
        const body = JSON.parse(String(init?.body));
        assert.equal(body.max_tokens, 2048, 'Analysis route applies the configured cap in both modes');
        assert.equal(body.reasoning_effort, 'high');
        assert.equal(body.contextWindow, undefined, 'Local configuration metadata is never sent upstream');
        assert.equal(body.maxOutputTokens, undefined);
        return stream ? new Response('data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } }) : Response.json({ choices: [{ message: { content: '{"tokens":[]}' } }] });
      };
      const response = await analyze(new NextRequest('http://localhost/api/analyze', { method: 'POST', headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' }, body: JSON.stringify({ baseUrl: services[0].baseUrl, model: 'model-a', prompt: '猫', stream, thinkingEnabled: true, caps: { ...caps, maxOutputTokens: 2048 } }) }));
      assert.equal(response.status, 200); await response.text();
    }
    assert.equal(calls, 2);
  } finally { globalThis.fetch = originalFetch; }
  console.log('Model settings tests passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
