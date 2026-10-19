# Bundled daily sentence pack

The 92 Japanese-English sentence pairs in `app/data/daily-sentences.json` are
selected from the Tatoeba corpus as distributed by Charles Kelly's ManyThings
Anki export: <https://www.manythings.org/anki/> (`jpn-eng.zip`).

The export describes its selection as Japanese sentences owned by identified
native speakers paired with English sentences personally checked and not
rejected by its maintainer. This does not guarantee that every sentence is free
of errors. The project selects everyday short sentences; this is not a JLPT
certification or a claim of independent human proofreading.

Text license: Creative Commons Attribution 2.0 France.
See [license copy](CC-BY-2.0-FR.html) and
<https://creativecommons.org/licenses/by/2.0/fr/>.

Attribution: ManyThings / Charles Kelly and Tatoeba contributors. Each original
and translation retains its Tatoeba sentence ID, owner name and license inside
the JSON. The app links to the original and displayed translation's Tatoeba
pages. No audio is included. Original Japanese text and English translations
are unchanged; the distribution is filtered and converted to JSON.
Simplified Chinese, Traditional Chinese and Korean translations are added by
the Japanese Analyzer project based on the Japanese originals and distributed
under CC BY 2.0 France with the original contributors' attribution retained.
They are stored in `scripts/daily-sentence/translations.tsv`, marked as
`provider: project`, and displayed as preset translations without an extra label; they are
not Tatoeba translations and have no invented Tatoeba IDs or author names.
This does not claim independent human proofreading.
Token boundaries, parts of speech and kana
readings are added by this project at build time using Kuromoji 0.1.2 / IPADIC,
with sentence-specific contextual reading corrections. These annotations are
not original Tatoeba transcriptions or a guarantee of independent proofreading.
See [Kuromoji's dictionary notice](kuromoji-IPADIC-NOTICE.md).

`scripts/daily-sentence/source.lock.json` records the source URL, archive SHA-256,
retrieval date and exact approved row fingerprints. `scripts/daily-sentence/approved.tsv`
retains the selected original rows for reproducible offline builds. The lock
also records the project's translation snapshot checksum. Rebuilding with
changed source text, attribution or project translations requires updating
the relevant fingerprints after review.

The original 60 four-language annotated sentences remain project-authored and
are separate from this third-party pack.
