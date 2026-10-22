import assert from 'node:assert/strict';
import test from 'node:test';
import { readLauncherLocale, normalizeLauncherLocale } from '../src-tauri/tauri-ui/locale.mjs';

test('fresh launcher uses the same Chinese default as the homepage', async () => {
  assert.equal(await readLauncherLocale({ readStored: () => null }), 'zh-CN');
  assert.equal(normalizeLauncherLocale('invalid'), 'zh-CN');
});
test('native homepage preference takes precedence over isolated launcher storage', async () => {
  for (const locale of ['zh-CN', 'zh-TW', 'en', 'ko']) {
    assert.equal(await readLauncherLocale({ readNative: async () => locale, readStored: () => 'en' }), locale);
  }
});
test('unavailable native lookup and blocked storage leave startup usable', async () => {
  assert.equal(await readLauncherLocale({ readNative: async () => { throw Error('unavailable'); }, readStored: () => 'ko' }), 'ko');
  assert.equal(await readLauncherLocale({ readNative: async () => 'invalid', readStored: () => { throw Error('blocked'); } }), 'zh-CN');
});

test('system language negotiation matches the native contract', async () => {
  const { readFile } = await import('node:fs/promises');
  const { matchSystemLocale, resolveLanguagePreference } = await import('../src-tauri/tauri-ui/locale.mjs');
  const cases = JSON.parse(await readFile(new URL('./fixtures/system-language.json', import.meta.url), 'utf8'));
  for (const { languages, expected } of cases) {
    assert.equal(matchSystemLocale(languages), expected, JSON.stringify(languages));
    assert.equal(resolveLanguagePreference(null, languages), expected);
    assert.equal(resolveLanguagePreference('system', languages), expected);
    assert.equal(resolveLanguagePreference('en', languages), 'en', 'manual selection overrides OS');
  }
  assert.equal(await readLauncherLocale({ readStored: () => null, languages: ['ko-KR'] }), 'ko');
  assert.equal(await readLauncherLocale({ readStored: () => 'zh-TW', languages: ['en-US'] }), 'zh-TW');
  assert.equal(await readLauncherLocale({ readStored: () => { throw Error('blocked'); }, languages: ['zh-Hant-HK'] }), 'zh-TW');
});
