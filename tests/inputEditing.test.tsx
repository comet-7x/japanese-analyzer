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
    onOpenSettings() { settingsOpened++; },
    activeService: null, endpoint: { baseUrl: '', model: '' },
    speechService: SPEECH_PRESETS[0], speechServices: [...SPEECH_PRESETS], onSpeechServiceChange() {},
  };
  let analyses = 0; let cancellations = 0; let cancelledEdits = 0; let settingsOpened = 0;
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
    await act(async () => { renderer!.update(view()); });
    const image = { type: 'image/png' };
    const expectUnsupported = () => {
      assert.ok(renderer!.root.findByProps({ role: 'alertdialog' }));
      assert.ok(JSON.stringify(renderer!.toJSON()).includes('当前模型不支持图片解析，请切换到支持图片输入的多模态模型。'));
      assert.equal(renderer!.root.findAllByProps({ id: 'imageUploadStatus' }).length, 0, 'Capability failures use a modal instead of a footer notice');
    };
    const dismissNotice = async () => {
      await act(async () => { renderer!.root.findByProps({ role: 'alertdialog' }).props.onCancel({ preventDefault() {} }); });
      assert.equal(renderer!.root.findAllByProps({ role: 'alertdialog' }).length, 0);
    };
    await act(async () => { renderer!.root.findByProps({ id: 'uploadImageButton' }).props.onClick(); });
    expectUnsupported(); await dismissNotice();
    await act(async () => { await renderer!.root.findByProps({ id: 'imageUploadInput' }).props.onChange({ target: { files: [image], value: 'image.png' } }); });
    expectUnsupported(); await dismissNotice();
    await act(async () => { await input().props.onDrop({ preventDefault() {}, dataTransfer: { files: [image] } }); });
    expectUnsupported(); await dismissNotice();
    await act(async () => { await input().props.onPaste({ preventDefault() {}, clipboardData: { items: [{ type: 'image/png', getAsFile: () => image }], getData: () => '' } }); });
    expectUnsupported(); await dismissNotice();
    await act(async () => { renderer!.root.findByProps({ id: 'uploadImageButton' }).props.onClick(); });
    await act(async () => { renderer!.root.findByProps({ role: 'alertdialog' }).findAllByType('button').find(button => button.children.includes('打开设置'))!.props.onClick(); });
    assert.equal(settingsOpened, 1, 'The capability notice offers a working settings shortcut');
    assert.equal(renderer!.root.findAllByProps({ role: 'alertdialog' }).length, 0);
    assert.equal(input().props.value, props.draft, 'Dismissing the notice preserves the original text');
    assert.equal(analyses, 0, 'Unsupported images do not start text analysis');
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
