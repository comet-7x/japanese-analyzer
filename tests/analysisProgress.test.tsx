import React from 'react';
import assert from 'node:assert/strict';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { LanguageProvider } from '../app/contexts/LanguageContext';
import AnalysisProgressView from '../app/components/AnalysisProgressView';
import AnalysisResult from '../app/components/AnalysisResult';
import { createTranslator, LOCALES, localizeError } from '../app/i18n';
import { messages } from '../app/i18n/messages';
import { AnalysisValidationError, type AnalysisErrorCode } from '../app/utils/requestErrors';
import type { AnalysisProgress } from '../app/utils/analysisSession';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
async function main() {
  const descriptors = new Map(['React', 'window', 'document', 'localStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { addEventListener() {}, removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { documentElement: {}, querySelector: () => null, title: '' } });
  const progress: AnalysisProgress = { status: 'failed', initialSuccess: false, tokens: [], confirmedTokens: [], chunks: [
    { id: '0:2', start: 0, end: 2, rootIndex: 0, status: 'complete', recovery: false, attempt: 1 },
    { id: '2:4', start: 2, end: 4, rootIndex: 1, status: 'failed', recovery: true, attempt: 1 },
  ] };
  let renderer: ReactTestRenderer | undefined;
  let retries = 0;
  const render = (value: AnalysisProgress) => <LanguageProvider><AnalysisProgressView progress={value} onRetry={() => retries++} /></LanguageProvider>;
  try {
    await act(async () => { renderer = create(render(progress)); });
    assert.ok(JSON.stringify(renderer!.toJSON()).includes('已保留成功结果'));
    await act(async () => renderer!.root.findByType('button').props.onClick());
    assert.equal(retries, 1);
    await act(async () => renderer!.update(render({ ...progress, status: 'running', chunks: progress.chunks.map(c => c.status === 'failed' ? { ...c, status: 'retrying' } : c) })));
    assert.equal(renderer!.root.findAllByType('button').length, 0);
    assert.ok(JSON.stringify(renderer!.toJSON()).includes('正在重试'));
    await act(async () => renderer!.update(render({ ...progress, status: 'complete' })));
    assert.equal(renderer!.toJSON(), null);
    for (const locale of LOCALES.filter(locale => locale !== 'zh-CN')) {
      const t = createTranslator(locale);
      for (const key of ['重试失败部分', '已完成 {0}/{1} 段', '正在重试 {0} 段', '{0} 段解析失败，已保留成功结果']) assert.ok(messages[key as keyof typeof messages]?.[locale]);
      assert.ok(t('重试失败部分')); 
      for (const code of ['invalid_json', 'invalid_tokens', 'source_mismatch', 'truncated', 'interrupted', 'timeout', 'content_filter'] satisfies AnalysisErrorCode[]) {
        const message = new AnalysisValidationError(code).message;
        assert.notEqual(localizeError(message, locale), message);
      }
    }
    await act(async () => renderer!.unmount()); renderer = undefined;
    await act(async () => { renderer = create(<LanguageProvider><AnalysisResult tokens={[]} showFurigana={false} onShowFuriganaChange={() => {}} showRomaji={false} onShowRomajiChange={() => {}} onWordClick={() => {}} selectedIndex={null} pendingText="猫がいる。" pendingActive={false} /></LanguageProvider>); });
    assert.ok(JSON.stringify(renderer!.toJSON()).includes('猫がいる。'), 'Failed gaps retain the original text');
    assert.equal(renderer!.root.findAll(node => node.props.className === 'word-unit-wrapper is-pending').length, 0, 'Failed gaps do not keep animating');
    console.log('Analysis progress passed: retained results, manual retry, running feedback, static gaps and all locales.');
  } finally {
    if (renderer) await act(async () => renderer!.unmount());
    descriptors.forEach((descriptor, key) => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
