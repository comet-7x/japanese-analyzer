import assert from 'node:assert/strict';
import { loadLocalTokenizer, localDraft, applyCorrections } from '../scripts/analysis-lab/local';
import { experimentConfig, qualityScore, runExperiments } from '../scripts/analysis-lab/run';
import { qualityCases } from './fixtures/analysisQuality';

async function main() {
  const tokenizer = await loadLocalTokenizer();
  for (const text of ['猫。\n\n犬。', '😀猫　ZZ未知語\r\n次。', '「引用」 [記事](https://example.org/a_(b)?x=%E3%81%A6)。', '  食べた。\t', 'ポムレリアンヌ。']) {
    const draft = localDraft(text, tokenizer);
    assert.equal(draft.tokens.map(token => token.word).join(''), text);
    assert.equal(draft.verified, false);
    assert.deepEqual(applyCorrections(draft, { edits: [] }).map(token => token.word).join(''), text);
    for (const token of draft.tokens) assert.equal(text.slice(token.start, token.end), token.word);
  }
  const quality = qualityCases.map(test => test.text).join('\n');
  const draft = localDraft(quality, tokenizer);
  assert.ok(qualityScore(draft.tokens).qualityCasesPassed < qualityCases.length, 'The context-reading counterexample must not be misreported as linguistically correct');
  assert.ok(qualityScore(draft.tokens).qualityAccuracy > 0.8);
  assert.ok(localDraft('ポムレリアンヌ。', tokenizer).tokens.some(token => token.review.includes('unknown')));
  const original = localDraft('猫がいる。', tokenizer);
  const untouched = JSON.stringify(original);
  const valid = applyCorrections(original, { edits: [{ from: 0, to: 1, tokens: [{ word: '猫', pos: '名詞', furigana: 'ねこ' }] }] });
  assert.equal(valid[0].furigana, 'ねこ');
  assert.equal(valid.map(token => token.word).join(''), original.source);
  for (const edits of [
    [{ from: -1, to: 1, tokens: [valid[0]] }],
    [{ from: 0, to: 99, tokens: [valid[0]] }],
    [{ from: 0, to: 1, tokens: [{ word: '犬', pos: '名詞', furigana: 'いぬ' }] }],
    [{ from: 0, to: 1, tokens: [{ word: '猫', pos: 'incorrect', furigana: 'ねこ' }] }],
    [{ from: 0, to: 1, tokens: [] }],
    [{ from: 0, to: 1, tokens: [valid[0]] }, { from: 0, to: 1, tokens: [valid[0]] }],
    [null],
  ]) assert.throws(() => applyCorrections(original, { edits }));
  assert.equal(JSON.stringify(original), untouched, 'Rejected or applied corrections never mutate the draft');
  assert.throws(() => experimentConfig({}), /Missing ANALYSIS_LAB/);
  assert.throws(() => experimentConfig({ ANALYSIS_LAB_BASE_URL: 'https://test.example', ANALYSIS_LAB_MODEL: 'test', ANALYSIS_LAB_API_KEY: 'secret', ANALYSIS_LAB_CAPS: '{}' }), /explicitly declare/);

  // Exercise the complete isolated CLI transport with deterministic provider fixtures.
  // Full analyses return the fixture draft; corrections return valid or invalid patches.
  const originalFetch = globalThis.fetch;
  let invalid = false;
  try {
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body.thinking, { type: 'disabled' });
      assert.equal(body.max_tokens, 8192);
      const prompt = body.messages[1].content as string;
      const full = prompt.match(/待解析句子.*： (.*)$/u);
      const content = full ? JSON.stringify({ tokens: localDraft(JSON.parse(full[1]), tokenizer).tokens })
        : JSON.stringify({ edits: invalid ? [{ from: 0, to: 1, tokens: [{ word: 'wrong', pos: '名詞', furigana: '' }] }] : [] });
      return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    };
    const config = experimentConfig({ ANALYSIS_LAB_BASE_URL: 'https://test.example', ANALYSIS_LAB_MODEL: 'test', ANALYSIS_LAB_API_KEY: 'sk-private', ANALYSIS_LAB_CAPS: '{"thinking":true,"jsonSchema":true}' });
    const report = await runExperiments({ mode: 'compare', text: '食べた。', runs: 1, config });
    assert.deepEqual(report.summary.map(row => row.profile), ['local', 'current', 'current-compact', 'small-compact', 'local-plus-model']);
    assert.ok(report.rows.every(row => row.sourcePreserved));
    assert.ok(report.rows.filter(row => row.profile !== 'local').every(row => row.modelVerified));
    const output = JSON.stringify(report);
    assert.ok(!output.includes('sk-private') && !output.includes('https://test.example') && !output.includes('食べた'));
    invalid = true;
    const rejected = await runExperiments({ mode: 'hybrid', text: '食べた。', runs: 1, config });
    assert.ok(rejected.rows.filter(row => row.profile === 'local-plus-model').every(row => !row.modelVerified && row.sourcePreserved));
  } finally { globalThis.fetch = originalFetch; }
  console.log('Analysis lab passed: local source coverage, school grammar, unknowns, atomic patches, private reports and opt-in model transport.');
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
