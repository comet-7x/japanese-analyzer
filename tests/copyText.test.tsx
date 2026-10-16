import React from 'react';
import assert from 'node:assert/strict';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { LanguageProvider } from '../app/contexts/LanguageContext';
import CopyTextButton from '../app/components/CopyTextButton';
import AnalysisResult from '../app/components/AnalysisResult';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function main() {
  const descriptors = new Map(['React', 'window', 'document', 'navigator', 'localStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const writes: string[] = [];
  let write: (text: string) => Promise<void> = async text => { writes.push(text); };
  Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    addEventListener() {}, removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { documentElement: {}, querySelector: () => null, title: '' } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: (text: string) => write(text) } } });
  let renderer: ReactTestRenderer | undefined;
  const wrap = (node: React.ReactNode) => <LanguageProvider>{node}</LanguageProvider>;
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
  try {
    await act(async () => { renderer = create(wrap(<AnalysisResult {...props} originalText={originalText} />)); });
    await copy('复制原文');
    assert.equal(writes.at(-1), originalText, 'Original copy preserves whitespace, Unicode and punctuation without annotations');
    assert.equal(button('复制原文').findByProps({ role: 'status' }).children.join(''), '已复制');
    assert.equal(renderer!.root.findAllByProps({ 'aria-label': '复制选中文本' }).length, 0, 'No selection copy before a selection');

    await act(async () => { renderer!.update(wrap(<AnalysisResult {...props} originalText={originalText} selectedIndex={0} />)); });
    await copy('复制选中文本');
    assert.equal(writes.at(-1), '猫', 'A selected word copies its surface form, without furigana/romaji');
    await act(async () => { renderer!.update(wrap(<AnalysisResult {...props} originalText={originalText} selectedRange={{ start: 0, end: 2 }} />)); });
    assert.equal(button('复制选中文本').findByProps({ role: 'status' }).children.join(''), '复制选中文本', 'Changing selection clears old feedback');
    await copy('复制选中文本');
    assert.equal(writes.at(-1), '猫がいる', 'Phrase copy joins selected tokens');
    await act(async () => { renderer!.update(wrap(<AnalysisResult {...props} selectedRange={{ start: 0, end: 5 }} />)); });
    await copy('复制选中文本');
    assert.equal(writes.at(-1), '猫がいる。\n𠮷', 'Sentence copy preserves included punctuation and newlines');
    await copy('复制原文');
    assert.equal(writes.at(-1), '猫がいる。\n𠮷', 'Standalone analysis can reconstruct the original from tokens');
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
    console.log('Copy text passed: exact original, word/phrase/sentence selections, feedback, stale completion and manual fallback.');
  } finally {
    if (renderer) await act(async () => { renderer!.unmount(); });
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
