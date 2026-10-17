import React from 'react';
import assert from 'node:assert/strict';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { LanguageProvider } from '../app/contexts/LanguageContext';
import InputSection from '../app/components/InputSection';
import { SPEECH_PRESETS } from '../app/lib/speechServices';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function main() {
  const descriptors = new Map(['React', 'window', 'document', 'localStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    addEventListener() {}, removeEventListener() {},
    matchMedia: () => ({ matches: true, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }),
  } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { documentElement: {}, querySelector: () => null, title: '' } });
  const props = {
    draft: '猫がいる。', onDraftChange() {},
    history: { entries: [], storageUnavailable: false, record() {}, clear() {} },
    onAnalyze() { analyses++; }, onCancelAnalyze() { cancellations++; },
    activeService: null, endpoint: { baseUrl: '', model: '' },
    speechService: SPEECH_PRESETS[0], speechServices: [...SPEECH_PRESETS], onSpeechServiceChange() {},
  };
  let analyses = 0; let cancellations = 0; let cancelledEdits = 0;
  const cancelEdit = () => { cancelledEdits++; };
  const view = (changes: Partial<React.ComponentProps<typeof InputSection>> = {}) => <LanguageProvider><InputSection {...props} {...changes} /></LanguageProvider>;
  let renderer: ReactTestRenderer | undefined;
  const cancelButton = () => renderer!.root.findAllByType('button').find(node => node.children.includes('取消编辑'));
  const input = () => renderer!.root.findByProps({ id: 'japaneseInput' });
  try {
    await act(async () => { renderer = create(view()); });
    assert.equal(Boolean(cancelButton()), false, 'Initial input has no edit session to cancel');
    await act(async () => { renderer!.update(view({ onCancelEdit: cancelEdit })); });
    assert.ok(cancelButton(), 'Expanded editor has an explicit cancel button');
    await act(async () => { cancelButton()!.props.onClick(); });
    assert.equal(cancelledEdits, 1);

    let prevented = false;
    await act(async () => { input().props.onKeyDown({ key: 'Escape', nativeEvent: { isComposing: false }, preventDefault() { prevented = true; } }); });
    assert.ok(prevented);
    assert.equal(cancelledEdits, 2, 'Escape uses the same cancellation as the button');
    await act(async () => { input().props.onKeyDown({ key: 'Escape', nativeEvent: { isComposing: true }, preventDefault() { throw new Error('IME Escape should be left alone'); } }); });
    assert.equal(cancelledEdits, 2, 'Escape cannot discard edits while closing an IME composition');

    await act(async () => { renderer!.update(view({ draft: '', onCancelEdit: cancelEdit })); });
    assert.equal(cancelButton()!.props.disabled, undefined, 'Clearing the draft does not prevent cancellation');
    await act(async () => { cancelButton()!.props.onClick(); });
    assert.equal(cancelledEdits, 3);

    await act(async () => { renderer!.update(view({ isAnalyzing: true, onCancelEdit: cancelEdit })); });
    await act(async () => { cancelButton()!.props.onClick(); });
    assert.equal(cancelledEdits, 4, 'Editing can close while the existing analysis continues');
    assert.equal(analyses, 0, 'Cancelling edits never starts a model request');
    assert.equal(cancellations, 0, 'Cancelling edits does not stop the existing analysis');
    await act(async () => { renderer!.unmount(); }); renderer = undefined;
    await act(async () => { renderer = create(view({ compact: true, onCancelEdit: cancelEdit })); });
    assert.equal(Boolean(cancelButton()), false, 'Reading toolbar does not expose cancel editing');
    console.log('Input editing passed: explicit cancellation, Escape/IME, empty draft, active analysis and reading state.');
  } finally {
    if (renderer) await act(async () => { renderer!.unmount(); });
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
