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
pages. No audio or third-party translations beyond the selected English pairs
are included. Sentence text and translations are unchanged; the distribution
is filtered and converted to JSON.

`scripts/daily-sentence/source.lock.json` records the source URL, archive SHA-256,
retrieval date and exact approved row fingerprints. `scripts/daily-sentence/approved.tsv`
retains the selected original rows for reproducible offline builds. Rebuilding with changed
source text or attribution requires updating the selection after review.

The original 60 four-language annotated sentences remain project-authored and
are separate from this third-party pack.
