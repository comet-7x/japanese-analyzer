# Local engine cross-validation

Development-only experiments. Nothing here is imported by the application. The
production parser and the existing `analysis:lab` kuromoji baseline are unchanged.
No model endpoint, browser profile, browser storage or API key is read.

## Reproduce

Use **Node 22** and Python 3.12 on the comparison machine. The checked-in run used
Node 22.23.3 and CPython 3.12.13 on macOS arm64. Browser verification used an
isolated headless Google Chrome, not the user's profile.

```sh
npm ci --prefix scripts/analysis-lab/engines --ignore-scripts
uv venv --python 3.12 .codex-dev/local-engines/venv
uv pip install --python .codex-dev/local-engines/venv/bin/python -r scripts/analysis-lab/engines/requirements.txt
.codex-dev/local-engines/venv/bin/python scripts/analysis-lab/engines/prepare.py
npm run analysis:engines
npm run analysis:engines:test
node scripts/analysis-lab/engines/browser.mjs
```

On Windows use the venv's `Scripts/python.exe`; the comparison orchestrator's
Python executable currently targets Unix. Cross-platform application packaging
has **not** been validated by this experiment. For another Chrome installation,
set `ENGINE_LAB_CHROME` to its executable before running `browser.mjs`.

`compare.ts --engines lindera-ipadic,sudachi-core-A --runs 3 --output path.json`
selects a subset. Run the complete comparison before browser verification because
the browser checks all its samples against those native/Node reference outputs.
The Python bindings measure the native Sudachi/MeCab/Vaporetto implementations;
they do not imply shipping Python with the application.

Versions are pinned in the independent npm lockfile and `requirements.txt`.
Downloaded dictionaries/models are pinned by SHA-256 in `assets.json`. Their
archives, notices, extracted resources, Python venv and raw fixture outputs stay
in the ignored `.codex-dev/local-engines/` directory. Default committed JSON
reports contain case IDs, counters and timings, not input text or raw tokens.

## What is compared

Thirteen configurations: kuromoji/IPADIC; Lindera native and WASM with IPADIC and
UniDic; MeCab via fugashi with IPADIC and UniDic-lite; Sudachi Core A/B/C and Small
A; Vaporetto's kana and pronunciation models.

- Three fresh processes per configuration, run sequentially. Each process performs
  50 warm tokenizations of the four-seasons fixture (447 UTF-16 code units,
  including its final newline) and ten
  tokenizations of its 20-fold repetition. The latter is a stress/performance
  input, not an accuracy benchmark.
- Logical cold initialization includes engine import/loading and dictionary
  initialization. The OS file cache is **not** flushed. The setup downloads,
  compilation and first-ever OS dynamic-library load are not represented by the
  median. This is not a cold-network or cold-machine benchmark.
- Warm timings include native tokenization and projection to common raw fields.
  Shared school conversion is timed separately. There are no model calls or
  application caches. RSS includes each runtime and the dictionaries touched by
  the fixture workload; it is not total reserved/addressable dictionary memory.
- Thirty hand-authored segmentation/POS/reading regression cases. `私` accepts
  both `わたし` and `わたくし`; canonical-only scores are retained separately.
  Seventeen safety cases cover spaces, CRLF, URLs, emoji/ZWJ, combining marks,
  compatibility glyphs, ellipses, quotes and long single sentences.
- A separate second-stage holdout has 19 sentences/21 whole-span reading targets.
  Readings are concatenated across token boundaries, so `一/人` cannot earn a
  correct score merely by covering the source. Standard alternatives for
  `明日` and `昨日` are accepted. Fixtures are frozen in `corpus.ts` and hashed
  in the report. This is a small developer-authored suite, not an independent
  representative corpus or a general Japanese accuracy estimate.
- Ambiguous `人気のない道` and other probes are excluded from accuracy scoring.
  Agreement among engines sharing a dictionary is not independent proof of
  linguistic correctness. Pairwise agreement is reported separately.
- Cross-checks include all fresh-process outputs, isolated versus joined quality
  inputs, production sentence chunks versus the whole long text, and real Chrome
  versus Node for kuromoji and both Lindera WASM configurations.

## Adapter boundaries

All engines share `school.ts`: POS label mapping, `形状詞/形容動詞語幹 + だ`
merging, `お/ご` prefix joining before a noun, kana conversion and source-space
restoration. This deliberately small conversion is not a complete school-grammar
implementation; e.g. further adjectival conjugations need separate validation.
There are no lexical fixes for counters, dates or particular words.

Source coverage is checked strictly in JS UTF-16 using original surfaces. Native
byte/codepoint offsets are not copied into frontend offsets. Any omitted,
duplicated or rewritten non-whitespace source fails validation.

Sudachi's normalization can emit zero-width original-surface continuations for
`…` and `㍿`. Its native bridge folds only zero-width records contiguous with the
preceding original span into that record, including their reading fragments.
The final exact source check still applies. Unexpected empty surfaces are rejected
by the common adapter. Normalized forms never replace original surfaces.

The Lindera 6.2.0 UniDic release contains 17 feature columns and lacks modern
UniDic's surface-kana column. Its surface pronunciation is used explicitly as a
fallback, never the lemma reading. For kana-only surfaces the written kana is
retained, but `学生 -> ガクセー` still differs from required `がくせい`.
Consequently these results describe this particular dictionary export, **not**
all UniDic versions or an intrinsic Lindera engine limitation. MeCab's UniDic-lite
has the surface-kana fields and provides an additional check on this distinction.

## Sources and redistribution

- [Lindera source/bindings](https://github.com/lindera/lindera) (MIT);
  dictionary notices are separate and remain with the release archives.
- [Sudachi.rs](https://github.com/WorksApplications/sudachi.rs) and
  [SudachiDict](https://github.com/WorksApplications/SudachiDict) (Apache-2.0;
  dictionary also includes its component notices). Engine/dictionary format
  compatibility is pinned together at 0.7.0 / 20261015.
- [MeCab](https://taku910.github.io/mecab/),
  [fugashi](https://github.com/polm/fugashi), and
  [UniDic-lite](https://github.com/polm/unidic-lite); retain the respective engine
  and dictionary licenses if integrated/distributed.
- [Vaporetto](https://github.com/daac-tools/vaporetto),
  [Python binding](https://github.com/daac-tools/python-vaporetto), and
  [models](https://github.com/daac-tools/vaporetto-models); engine and model notices
  are separate and are supplied in the downloaded model archives.
- [kuromoji.js](https://github.com/takuyaa/kuromoji.js) and its IPADIC notice remain
  with the existing pinned development dependency.

See [the measured comparison and decision](./RESULTS.md),
[native/Node metrics](../results/engines.json), and
[Chrome metrics](../results/engines-browser.json).
