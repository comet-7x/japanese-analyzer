# Analysis experiments

This development-only CLI does not change application settings, read browser
storage, use production caches, or add kuromoji to the application bundle.
Requires the project's Node 22 runtime. The pinned development dependency is
`kuromoji@0.1.2` with its bundled IPADIC dictionary. Source and dictionary notices:
[kuromoji.js](https://github.com/takuyaa/kuromoji.js),
[IPADIC notice](https://github.com/takuyaa/kuromoji.js/blob/master/NOTICE.md).

## Run

```sh
# Offline: three warm runs after a separately timed dictionary initialization.
npm run analysis:lab

# Copy .env.analysis-lab.example to .env.analysis-lab.local and fill in the
# explicit endpoint/model/key/capabilities locally before any network experiment.
npm run analysis:lab -- --mode compare --runs 3

# Individual profiles; --mode model runs all three pure-model configurations.
npm run analysis:lab -- --mode hybrid --runs 3
npm run analysis:lab -- --mode model --text-file tests/fixtures/four-seasons.txt
```

`local` is the default and makes no network requests. `compare` sequentially
evaluates current chunks, current chunks with compact JSON, smaller chunks
(160/240/100) with compact JSON, and local drafts plus model corrections. Each
configuration runs the same long text and a separate hand-authored school-grammar
corpus three times. Individual analyses may issue up to three concurrent requests;
the experimental hybrid uses the same three-request limit. Runs and configurations are executed sequentially.
Translation requests do not run in the CLI. Model reasoning is explicitly disabled
only when `ANALYSIS_LAB_CAPS.thinking` declares parameter support.

## Interpretation

- `firstTokenMs` measures the first displayable token; for local/hybrid it is an
  **unverified draft**, not a completed model correction. `localInitialization`
  separately reports cold dictionary loading and the process RSS increase.
- `initialSuccess` excludes model runs that needed recovery. `recoveredSuccess`
  reports final success; `modelVerified` distinguishes local drafts from completed
  model results. The hybrid prototype rejects an invalid correction atomically,
  retains its local draft, and records `modelVerified: false` without retrying.
- Quality compares exact token boundaries, school POS and effective readings to
  nine fixed fixtures. A pure-kana word may have empty furigana. This is a small
  regression corpus, not an estimate of general Japanese accuracy.
- Every result must preserve the original text exactly. Successful reconstruction
  does not prove that segmentation, readings or POS are correct. Even an empty
  model correction list is a model judgment, not a formal linguistic proof.
- Default JSON reports include metrics and case IDs, never source text, model
  response text, thoughts, endpoint URLs or keys. Do not compare fixture responses
  from mocked tests to live provider timings.

## Current offline finding

The measured offline run is in `results/local.json`. The long text was preserved
in all three runs and eight of nine fixed cases passed. The counterexample `人気のない道` receives the dictionary reading にんき instead of the fixture’s contextual ひとけ, illustrating why fast source-preserving output still requires language-quality checks. Dictionary initialization
used hundreds of MiB of process RSS in this Node process; these numbers do not
measure browser/Worker startup or memory. Keep this engine experimental until a
larger corpus and live model-correction results justify integrating it.

The default application retains 280/420/180 chunks, three request slots and an
8192 output limit. Its recoverable session keeps successful spans, makes at most
one automatic recovery round per original chunk (up to two smaller requests),
then exposes manual failed-span retries. Every request has a 120-second deadline;
HTTP/configuration/content-filter failures and timeouts do not automatically retry.
