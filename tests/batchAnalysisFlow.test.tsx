import React from 'react';
import assert from 'node:assert/strict';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import SelectionDetailPanel from '../app/components/SelectionDetailPanel';
import { LanguageProvider } from '../app/contexts/LanguageContext';
import { ExternalLookupProvider } from '../app/contexts/ExternalLookupContext';
import type { TokenData } from '../app/services/api';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const tick = () => new Promise<void>(resolve => setImmediate(resolve));


const sampleTokens: TokenData[] = [
  { word: '猫', furigana: 'ねこ', romaji: 'neko', pos: '名詞' },
];

const textOf = (node: ReactTestInstance | string): string => typeof node === 'string' ? node : node.children.map(textOf).join('');

async function main() {
  const originalFetch = globalThis.fetch;
  const storage = { getItem: () => null, setItem: () => {} };
  Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { addEventListener() {}, removeEventListener() {}, localStorage: storage } });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { documentElement: { lang: 'zh-CN' }, querySelector: () => null, title: '' } });

  const pending: Array<{ url: string; body: Record<string, unknown>; signal: AbortSignal; resolve: (response: Response) => void }> = [];
  let renderer: ReactTestRenderer | undefined;

  try {
    globalThis.fetch = async (input, init) => new Promise<Response>(resolve => pending.push({
      url: String(input), body: JSON.parse(String(init?.body)), signal: init!.signal!, resolve,
    }));

    await act(async () => {
      renderer = create(
        <LanguageProvider>
          <ExternalLookupProvider>
            <SelectionDetailPanel
              selectedText="猫"
              pos="名詞"
              reading="ねこ"
              context="猫がいる。"
              tokens={sampleTokens}
              selectionKind="word"
              identity="test:1:0:0"
              model={{ endpoint: { baseUrl: 'https://model.example/v1', model: 'test' }, apiKey: 'key' }}
              onClose={() => undefined}
              onEdit={() => undefined}
              canEdit={false}
              canGroup={false}
            />
          </ExternalLookupProvider>
        </LanguageProvider>
      );
    });

    assert.equal(pending.length, 0, 'Opening selection detail panel must not eagerly send network requests');

    // Find the batch analyze button
    const root = renderer!.root;
    const batchButton = root.findByProps({ className: 'batch-analyze-btn' });
    assert.ok(batchButton, 'Batch analyze button must exist');
    assert.equal(batchButton.props.disabled, false);
    assert.ok(textOf(batchButton).includes('一键完整解析'), 'Button text should be 一键完整解析');

    // Simulate user manually expanding and loading Translation first
    const disclosures = root.findAllByProps({ className: 'detail-disclosure' });
    // disclosures[0] is translation
    const translationDisclosure = disclosures[0];
    await act(async () => {
      translationDisclosure.props.onToggle({ currentTarget: { open: true } });
    });

    assert.equal(pending.length, 1, 'Opening translation lazy disclosure must trigger only translation request');
    assert.equal(pending[0].body.task, 'translate');

    // Resolve translation
    await act(async () => {
      pending[0].resolve(Response.json({ translation: '猫咪' }));
      await tick();
    });

    // Now translation is loaded. Let's click "一键完整解析"
    // Since translation is already done, it should ONLY trigger analysis, NOT duplicate translation
    const updatedBatchBtn = root.findByProps({ className: 'batch-analyze-btn' });
    await act(async () => {
      updatedBatchBtn.props.onClick();
    });

    // Verify: Only 1 new request was added (for analyze), so pending.length is 2
    assert.equal(pending.length, 2, 'Batch analyze must NOT duplicate already generated translation (Token protection)');
    assert.equal(pending[1].body.task, 'analyze', 'Pending request must be analysis');

    // The button should now be in generating state showing progress (1/2)
    const generatingBtn = root.findByProps({ className: 'batch-analyze-btn is-generating' });
    assert.ok(generatingBtn, 'Button should have is-generating class');
    assert.equal(generatingBtn.props.disabled, true);
    assert.ok(
      textOf(generatingBtn).includes('(1/2)'),
      'Progress must display (1/2) because 1 of 2 tasks was already completed'
    );

    // Resolve analysis
    await act(async () => {
      pending[1].resolve(Response.json({
        dictionaryForm: '猫',
        category: '単語',
        explanation: '小型食肉目哺乳类动物。',
        example: '猫が好きです。',
        exampleTranslation: '喜欢猫。',
        pos: '名詞',
        furigana: 'ねこ',
      }));
      await tick();
    });

    // Now all 2 tasks are done! The button must become "重新解析" and remain enabled for re-analysis
    const reanalyzeBtn = root.findByProps({ className: 'batch-analyze-btn' });
    assert.ok(reanalyzeBtn, 'Button should transition to batch-analyze-btn');
    assert.equal(reanalyzeBtn.props.disabled, false, 'Button should NOT be disabled so user can re-analyze');
    assert.ok(
      textOf(reanalyzeBtn).includes('重新解析'),
      'Button text must transition to 重新解析'
    );

    // Clicking "重新解析" should force re-analysis and trigger fresh network requests bypassing cache
    await act(async () => {
      reanalyzeBtn.props.onClick();
    });
    assert.equal(pending.length, 4, 'Re-analyzing must trigger 2 new requests (translate + analyze) with force=true');
    await act(async () => {
      pending[2].resolve(Response.json({ translation: '猫猫（刷新）' }));
      pending[3].resolve(Response.json({
        dictionaryForm: '猫', category: '単語', explanation: '刷新后的解析。',
        example: '', exampleTranslation: '', pos: '名詞', furigana: 'ねこ',
      }));
      await tick();
    });

    // Test Issue 1: Merge and Undo must preserve the analysis cache when re-selecting with a new revision identity
    let newPanelRenderer: ReactTestRenderer | undefined;
    await act(async () => {
      newPanelRenderer = create(
        <LanguageProvider>
          <ExternalLookupProvider>
            <SelectionDetailPanel
              selectedText="猫"
              pos="名詞"
              reading="ねこ"
              context="猫がいる。"
              tokens={sampleTokens}
              selectionKind="word"
              identity="test:3:0:0"
              model={{ endpoint: { baseUrl: 'https://model.example/v1', model: 'test' }, apiKey: 'key' }}
              onClose={() => undefined}
              onEdit={() => undefined}
              canEdit={false}
              canGroup={false}
            />
          </ExternalLookupProvider>
        </LanguageProvider>
      );
    });
    assert.equal(pending.length, 4, 'Opening selection with new revision identity must restore from cache without extra requests');
    const newRoot = newPanelRenderer!.root;
    const newReanalyzeBtn = newRoot.findByProps({ className: 'batch-analyze-btn' });
    assert.ok(
      textOf(newReanalyzeBtn).includes('重新解析'),
      'Cached selection must immediately show 重新解析 button because all fields are loaded from cache'
    );
    await act(async () => {
      newPanelRenderer!.unmount();
    });

    // Verify long sentence selection without truncation and cross-line selection
    const { normalizePhraseRange } = await import('../app/utils/phraseRange');
    const longSentenceTokens: TokenData[] = [
      { word: '彼', pos: '名詞' }, { word: 'は', pos: '助詞' }, { word: '昨日', pos: '名詞' },
      { word: '、', pos: '記号' }, { word: '図書館', pos: '名詞' }, { word: 'に', pos: '助詞' },
      { word: '行って', pos: '動詞' }, { word: '本', pos: '名詞' }, { word: 'を', pos: '助詞' },
      { word: '借りて', pos: '動詞' }, { word: '\n', pos: '改行' }, { word: '家', pos: '名詞' },
      { word: 'で', pos: '助詞' }, { word: 'ゆっくり', pos: '副詞' }, { word: '読んだ', pos: '動詞' },
      { word: '。', pos: '記号' },
    ];
    const range = normalizePhraseRange(longSentenceTokens, 0, 15);
    assert.deepEqual(range, { start: 0, end: 15 }, 'normalizePhraseRange should handle cross-line selection');
    // Verify reopening an already analyzed long sentence: must show 重新解析
    let longSentencePanel: ReactTestRenderer | undefined;
    await act(async () => {
      longSentencePanel = create(
        <LanguageProvider>
          <ExternalLookupProvider>
            <SelectionDetailPanel
              selectedText="猫がいる。"
              pos=""
              reading=""
              context="猫がいる。"
              tokens={[{ word: '猫', pos: '名詞' }, { word: 'が', pos: '助詞' }, { word: 'いる', pos: '動詞' }, { word: '。', pos: '記号' }]}
              selectionKind="phrase"
              identity="test:4:0:3"
              model={{ endpoint: { baseUrl: 'https://model.example/v1', model: 'test' }, apiKey: 'key' }}
              onClose={() => undefined}
              onEdit={() => undefined}
              canEdit={false}
              canGroup={false}
            />
          </ExternalLookupProvider>
        </LanguageProvider>
      );
    });
    // First run batch analysis on the sentence
    const lsRoot = longSentencePanel!.root;
    const lsBatchBtn = lsRoot.findByProps({ className: 'batch-analyze-btn' });
    await act(async () => {
      lsBatchBtn.props.onClick();
    });
    assert.equal(pending.length, 6, 'Long sentence batch analysis should trigger 2 requests (translate + analyze) without conjugation');
    await act(async () => {
      for (const disclosure of lsRoot.findAllByProps({ className: 'detail-disclosure' }).slice(0, 2)) {
        disclosure.props.onToggle({ currentTarget: { open: true } });
      }
    });
    assert.equal(pending.length, 6, 'Programmatic disclosure toggle reuses the requests already started by batch analysis');
    assert.equal(pending[4].signal.aborted, false);
    assert.equal(pending[5].signal.aborted, false);
    await act(async () => {
      pending[4].resolve(Response.json({ translation: '有猫。' }));
      pending[5].resolve(Response.json({
        dictionaryForm: '', category: '文', explanation: '完整陈述句。',
        example: '', exampleTranslation: '', pos: '', furigana: '',
      }));
      await tick();
    });
    await act(async () => {
      longSentencePanel!.unmount();
    });

    // Reopen the same sentence with a new selection identity
    let reopenSentencePanel: ReactTestRenderer | undefined;
    await act(async () => {
      reopenSentencePanel = create(
        <LanguageProvider>
          <ExternalLookupProvider>
            <SelectionDetailPanel
              selectedText="猫がいる。"
              pos=""
              reading=""
              context="猫がいる。"
              tokens={[{ word: '猫', pos: '名詞' }, { word: 'が', pos: '助词' }, { word: 'いる', pos: '動詞' }, { word: '。', pos: '記号' }]}
              selectionKind="phrase"
              identity="test:5:0:3"
              model={{ endpoint: { baseUrl: 'https://model.example/v1', model: 'test' }, apiKey: 'key' }}
              onClose={() => undefined}
              onEdit={() => undefined}
              canEdit={false}
              canGroup={false}
            />
          </ExternalLookupProvider>
        </LanguageProvider>
      );
    });
    const reopenRoot = reopenSentencePanel!.root;
    const reopenBtn = reopenRoot.findByProps({ className: 'batch-analyze-btn' });
    assert.ok(
      textOf(reopenBtn).includes('重新解析'),
      'Reopening an already analyzed sentence must display 重新解析 immediately'
    );
    await act(async () => {
      reopenSentencePanel!.unmount();
    });

    const verbView = (identity: string, word = '走った') => <LanguageProvider><ExternalLookupProvider>
      <SelectionDetailPanel selectedText={word} pos="動詞" reading="" context="昨日走った。"
        tokens={[{ word, pos: '動詞' }]} selectionKind="word" identity={identity}
        model={{ endpoint: { baseUrl: 'https://model.example/v1', model: 'test' }, apiKey: 'key' }}
        onClose={() => undefined} onEdit={() => undefined} canEdit={false} canGroup={false} />
    </ExternalLookupProvider></LanguageProvider>;
    let verbPanel!: ReactTestRenderer;
    await act(async () => { verbPanel = create(verbView('verb:1')); });
    const verbStart = pending.length;
    await act(async () => { verbPanel.root.findByProps({ className: 'batch-analyze-btn' }).props.onClick(); });
    await act(async () => {
      for (const disclosure of verbPanel.root.findAllByProps({ className: 'detail-disclosure' }).slice(0, 2)) {
        disclosure.props.onToggle({ currentTarget: { open: true } });
      }
    });
    assert.equal(pending.length, verbStart + 2);
    await act(async () => {
      pending[verbStart].resolve(Response.json({ translation: '跑过' }));
      pending[verbStart + 1].resolve(Response.json({ dictionaryForm: '走る', explanation: '过去形', example: '', exampleTranslation: '', pos: '動詞', furigana: '' }));
      await tick();
    });
    assert.equal(pending.length, verbStart + 3, 'Exactly one conjugation request follows successful analysis');
    const conjugationRequest = pending[verbStart + 2];
    assert.equal(conjugationRequest.url, '/api/conjugation');
    assert.equal(conjugationRequest.body.dictionaryForm, '走る', 'Batch conjugation uses the returned lemma without waiting for a React commit');
    assert.equal(conjugationRequest.signal.aborted, false, 'Committing the inferred lemma does not cancel conjugation');
    await act(async () => {
      conjugationRequest.resolve(Response.json({ insufficient: false, analyses: [{ dictionaryForm: '走る', steps: [{ form: '走る', label: '原形' }, { form: '走った', label: '过去形' }], note: '' }] }));
      await tick();
    });
    assert.equal(verbPanel.root.findAllByProps({ className: 'conjugation-chain' }).length, 1);
    assert.match(textOf(verbPanel.root.findByProps({ className: 'batch-analyze-btn' })), /重新解析/);
    const verbDisclosure = verbPanel.root.findByProps({ className: 'detail-disclosure conjugation-tool' });
    await act(async () => { verbDisclosure.props.onToggle({ currentTarget: { open: false } }); });
    assert.equal(verbPanel.root.findByProps({ className: 'detail-disclosure conjugation-tool' }).props.open, false, 'Batch-opened panels remain collapsible');

    await act(async () => { verbPanel.update(verbView('verb:2', '泳いだ')); });
    const staleStart = pending.length;
    await act(async () => { verbPanel.root.findByProps({ className: 'batch-analyze-btn' }).props.onClick(); });
    await act(async () => { verbPanel.update(verbView('verb:3', '読んだ')); });
    await act(async () => {
      pending[staleStart].resolve(Response.json({ translation: '游过' }));
      pending[staleStart + 1].resolve(Response.json({ dictionaryForm: '泳ぐ', explanation: '', example: '', exampleTranslation: '', pos: '', furigana: '' }));
      await tick();
    });
    assert.equal(pending.length, staleStart + 2, 'A stale batch cannot start conjugation for the new selection');
    assert.equal(verbPanel.root.findByProps({ className: 'batch-analyze-btn' }).props.disabled, false);
    await act(async () => { verbPanel.unmount(); });

    // Verify single-word clicking on AnalysisResult: button click must fire onWordClick
    const { default: AnalysisResult } = await import('../app/components/AnalysisResult');
    let clickedWord: string | null = null;
    let analysisResultRenderer: ReactTestRenderer | undefined;
    await act(async () => {
      analysisResultRenderer = create(
        <LanguageProvider>
          <AnalysisResult
            tokens={sampleTokens}
            showFurigana={true}
            onShowFuriganaChange={() => {}}
            showRomaji={false}
            onShowRomajiChange={() => {}}
            onWordClick={(token) => { clickedWord = token.word; }}
            selectedIndex={null}
            onRangeSelect={() => {}}
          />
        </LanguageProvider>
      );
    });
    const wordButton = analysisResultRenderer!.root.findByProps({ className: 'word-token' });
    await act(async () => {
      wordButton.props.onClick();
    });
    assert.equal(clickedWord, '猫', 'Single word click must properly fire onWordClick without being blocked by selection');
    await act(async () => {
      analysisResultRenderer!.unmount();
    });

    console.log('Batch analysis flow passed: token deduplication, progress state transitions and completion state.');
  } finally {
    if (renderer) await act(async () => { renderer!.unmount(); });
    globalThis.fetch = originalFetch;
  }
}

void main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
