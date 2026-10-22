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
