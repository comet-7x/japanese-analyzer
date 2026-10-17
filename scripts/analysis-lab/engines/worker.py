"""Same experiment protocol as worker.mjs; Python bindings call native engines."""
import json
import pathlib
import resource
import sys
import time

import psutil

request = json.load(sys.stdin)
engine = request['engine']
cache = pathlib.Path(request['cache'])
process = psutil.Process()
baseline = process.memory_info().rss
started = time.perf_counter()

if engine.startswith('sudachi-'):
    import importlib.metadata
    import sudachipy
    from sudachipy import Dictionary, SplitMode
    edition, mode_name = engine.split('-')[1:]
    dictionary = Dictionary(dict=edition)
    tokenizer = dictionary.tokenizer()
    mode = getattr(SplitMode, mode_name)
    module = __import__('sudachidict_' + edition)
    dictionary_path = pathlib.Path(module.__file__).parent / 'resources' / 'system.dic'
    version = f"sudachipy@{importlib.metadata.version('sudachipy')} / {edition}@{importlib.metadata.version('sudachidict_' + edition)} / {mode_name}"

    def tokenize(text):
        result = []
        previous_end = -1
        for m in tokenizer.tokenize(text, mode):
            word = m.surface()
            # Sudachi expands e.g. ㍿ -> 株式 + 会社 and … -> . + . + . .
            # Later pieces have a zero-width ORIGINAL span. Fold only these
            # continuations into their source-owning predecessor, including
            # every reading fragment. Never discard original text.
            if not word and m.begin() == m.end() == previous_end and result:
                result[-1]['reading'] += m.reading_form()
                result[-1]['expandedParts'] = result[-1].get('expandedParts', 0) + 1
                continue
            result.append(dict(word=word, pos=list(m.part_of_speech()), reading=m.reading_form(), lemma=m.dictionary_form(), unknown=m.is_oov()))
            previous_end = m.end()
        return result

elif engine.startswith('mecab-'):
    import importlib.metadata
    import fugashi
    kind = engine.split('-')[1]
    module = __import__('ipadic' if kind == 'ipadic' else 'unidic_lite')
    tokenizer = fugashi.GenericTagger(f'-r "{module.DICDIR}/mecabrc" -d "{module.DICDIR}"')
    dictionary_path = pathlib.Path(module.DICDIR)
    version = f"fugashi@{importlib.metadata.version('fugashi')} (bundled MeCab) / {kind}@{importlib.metadata.version('ipadic' if kind == 'ipadic' else 'unidic-lite')}"

    def tokenize(text):
        return [dict(word=m.surface, pos=list(m.feature[:4]), reading=m.feature[17 if kind == 'unidic' else 7] if len(m.feature) > (17 if kind == 'unidic' else 7) else '',
                     lemma=m.feature[7 if kind == 'unidic' else 6] if len(m.feature) > 7 else '', unknown=m.is_unk)
                for m in tokenizer(text)]

elif engine.startswith('vaporetto-'):
    import importlib.metadata
    import vaporetto
    import zstandard
    kind = engine.split('-')[1]
    folder = cache / f'bccwj-suw+unidic_pos+{kind}'
    dictionary_path = next(folder.rglob('*.model.zst'))
    with dictionary_path.open('rb') as compressed:
        with zstandard.ZstdDecompressor().stream_reader(compressed) as reader:
            model = reader.read()
    tokenizer = vaporetto.Vaporetto(model, predict_tags=True)
    del model
    version = f"vaporetto-python@{importlib.metadata.version('vaporetto')} (Rust {vaporetto.VAPORETTO_VERSION}) / model v0.5.0 {kind}"

    def tokenize(text):
        return [dict(word=t.surface(), pos=(t.tag(0) or '').split('-'), reading=t.tag(1) or '', readingKind='pronunciation' if kind == 'pron' else 'kana', unknown=False)
                for t in tokenizer.tokenize(text)]
else:
    raise ValueError('Unknown engine')

cold_ms = (time.perf_counter() - started) * 1000
rss_after_init = process.memory_info().rss
dictionary_bytes = sum(p.stat().st_size for p in dictionary_path.rglob('*') if p.is_file()) if dictionary_path.is_dir() else dictionary_path.stat().st_size
samples = []
for item in request['texts']:
    try:
        samples.append(dict(id=item['id'], raw=tokenize(item['text'])))
    except Exception as error:
        samples.append(dict(id=item['id'], error=str(error)))
times = []
for _ in range(request['iterations']):
    start = time.perf_counter()
    tokenize(request['performanceText'])
    times.append((time.perf_counter() - start) * 1000)
stress_times = []
for _ in range(10):
    start = time.perf_counter()
    tokenize(request['performanceText'] * 20)
    stress_times.append((time.perf_counter() - start) * 1000)
peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
json.dump(dict(engine=engine, version=version, runtime=sys.version.split()[0], dictionaryBytes=dictionary_bytes, coldMs=cold_ms,
               rssBefore=baseline, rssAfterInit=rss_after_init, rssAfterWarm=process.memory_info().rss,
               peakRss=peak if sys.platform == 'darwin' else peak * 1024,
               times=times, stressTimes=stress_times, samples=samples), sys.stdout, ensure_ascii=False)
