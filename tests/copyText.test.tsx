import React from 'react';
import assert from 'node:assert/strict';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { LanguageProvider } from '../app/contexts/LanguageContext';
import CopyTextButton from '../app/components/CopyTextButton';
import AnalysisResult from '../app/components/AnalysisResult';
import InputSection from '../app/components/InputSection';
import SelectionDetailPanel from '../app/components/SelectionDetailPanel';
import { ExternalLookupProvider } from '../app/contexts/ExternalLookupContext';
import { SPEECH_PRESETS } from '../app/lib/speechServices';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function main() {
  const descriptors = new Map(['React', 'window', 'document', 'navigator', 'localStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const writes: string[] = [];
  let write: (text: string) => Promise<void> = async text => { writes.push(text); };
  Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    addEventListener() {}, removeEventListener() {},
    matchMedia: () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }),
  } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { documentElement: {}, querySelector: () => null, title: '' } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: (text: string) => write(text) } } });
  let renderer: ReactTestRenderer | undefined;
  const wrap = (node: React.ReactNode) => <LanguageProvider><ExternalLookupProvider>{node}</ExternalLookupProvider></LanguageProvider>;
  const button = (label: string) => renderer!.root.findByProps({ 'aria-label': label });
  const copy = async (label: string) => { await act(async () => { button(label).props.onClick(); }); };
  const tokens = [
    { word: '猫', pos: '名詞', furigana: 'ねこ', romaji: 'neko' },
    { word: 'が', pos: '助詞', romaji: 'ga' },
    { word: 'いる', pos: '動詞', romaji: 'iru' },
    { word: '。', pos: '記号' },
    { word: '\n', pos: '改行' },
    { word: '𠮷', pos: '名詞' },
  ];
  const props = { tokens, showFurigana: true, onShowFuriganaChange() {}, showRomaji: true, onShowRomajiChange() {}, onWordClick() {}, selectedIndex: null, showDisplayOptions: false };
  const originalText = '  猫がいる。\n𠮷  ';
  const endpoint = { baseUrl: '', model: '' };
  const history = { entries: [], storageUnavailable: false, record() {}, clear() {} };
  const view = (selection = '') => wrap(<>
    <InputSection draft="unsubmitted edit" originalText={originalText} onDraftChange={() => {}} history={history}
      onAnalyze={() => {}} onCancelAnalyze={() => {}} activeService={null} endpoint={endpoint}
      speechService={SPEECH_PRESETS[0]} speechServices={[...SPEECH_PRESETS]} onSpeechServiceChange={() => {}} compact />
    <AnalysisResult {...props} selectedIndex={selection ? 0 : null} />
    {selection && <SelectionDetailPanel selectedText={selection} pos="名詞" reading="" context={originalText}
      tokens={tokens} selectionKind="phrase" identity={selection}
      model={{ endpoint }} onClose={() => {}} onEdit={() => {}} canEdit={false} canGroup={false} />}

  </>);

  try {
    await act(async () => { renderer = create(view()); });
    assert.equal(renderer!.root.findByProps({ role: 'toolbar' }).findAllByProps({ 'aria-label': '复制原文' }).length, 1, 'Original copy lives in the original-text toolbar');
    assert.equal(renderer!.root.findByType(AnalysisResult).findAllByType(CopyTextButton).length, 0, 'Analysis output has no duplicate copy actions');
    await copy('复制原文');
    assert.equal(writes.at(-1), originalText, 'Original copy uses the analyzed text, preserving whitespace and Unicode, rather than the unsubmitted draft');
    assert.equal(button('复制原文').findByProps({ role: 'status' }).children.join(''), '已复制');
    assert.equal(renderer!.root.findAllByProps({ 'aria-label': '复制选中文本' }).length, 0);

    for (const selection of ['猫', '猫がいる', '猫がいる。\n𠮷', '猫'] as const) {
      await act(async () => { renderer!.update(view(selection)); });
      assert.equal(renderer!.root.findAllByProps({ 'aria-label': '复制选中文本' }).length, 1, 'Only one selection copy action across the toolbar, output and detail');
      const heading = renderer!.root.findByType(SelectionDetailPanel).findByType('h2').parent!;
      assert.ok(heading.findByProps({ 'aria-label': '复制选中文本' }));
      assert.ok(heading.findByProps({ 'aria-label': '朗读发音' }), 'Copy and pronunciation are beside the selection title');
      assert.equal(button('复制选中文本').props.title, '复制选中文本');
      assert.equal(button('复制选中文本').findByProps({ role: 'status' }).props.className, 'sr-only', 'Selection copy displays only its icon');
      await copy('复制选中文本');
      assert.equal(writes.at(-1), selection, 'Copy uses the exact selected surface text independently of model output');
      assert.equal(button('复制选中文本').props.title, '已复制');
    }
    await act(async () => { renderer!.unmount(); }); renderer = undefined;

    let complete!: () => void;
    write = () => new Promise<void>(resolve => { complete = resolve; });
    await act(async () => { renderer = create(wrap(<CopyTextButton text="old" />)); });
    await copy('复制');
    assert.equal(button('复制').findByProps({ role: 'status' }).children.join(''), '复制', 'Do not report success before clipboard resolves');
    await act(async () => { renderer!.update(wrap(<CopyTextButton text="new" />)); complete(); });
    assert.equal(button('复制').findByProps({ role: 'status' }).children.join(''), '复制', 'Late clipboard success cannot label a new selection as copied');

    write = async () => { throw new Error('denied'); };
    await copy('复制');
    assert.equal(renderer!.root.findByType('textarea').props.value, 'new', 'Denied clipboard offers the correct text for manual copy');
    assert.equal(renderer!.root.findAllByProps({ role: 'status' }).some(node => node.children.includes('已复制')), false, 'Failure must not show success');
    let selected = false;
    renderer!.root.findByType('textarea').props.onFocus({ target: { select() { selected = true; } } });
    assert.ok(selected);

    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
    await copy('复制');
    assert.equal(renderer!.root.findByType('textarea').props.value, 'new', 'Unavailable clipboard also supports manual copy');
    await act(async () => { renderer!.update(wrap(<CopyTextButton text="   " />)); });
    assert.equal(button('复制').props.disabled, true, 'Empty text cannot be copied');
    console.log('Copy text passed: toolbar original, single selection icon beside pronunciation, exact surface text, feedback and manual fallback.');
  } finally {
    if (renderer) await act(async () => { renderer!.unmount(); });
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
