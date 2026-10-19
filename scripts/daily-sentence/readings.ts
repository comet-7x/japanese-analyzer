import kuromoji, { type IpadicFeatures, type Tokenizer } from 'kuromoji';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { hasDailySentenceReadings } from '../../app/utils/dailySentences';
import { schoolTokens } from '../../app/utils/localTokens';
import { getLocalRomaji } from '../../app/utils/romaji';

const require = createRequire(import.meta.url);
let pending: Promise<Tokenizer<IpadicFeatures>> | undefined;
// Reviewed contextual readings for the exact, fingerprinted source sentences.
const overrides: Record<string, Record<string, string>> = {
  '何ていったんですか。': { '何': 'なん' },
  'ああ、お腹が空いた。': { '空い': 'すい' },
};

/** Build-time only: the browser receives annotated data, never the tokenizer or its dictionary. */
export async function annotateSentence(text: string) {
  const tokenizer = await (pending ??= new Promise<Tokenizer<IpadicFeatures>>((resolve, reject) => {
    const dicPath = join(dirname(require.resolve('kuromoji/package.json')), 'dict');
    kuromoji.builder({ dicPath }).build((error, result) => error ? reject(error) : resolve(result));
  }));
  const tokens = schoolTokens(text, tokenizer.tokenize(text).map(item => ({ word: item.surface_form,
    pos: [item.pos, item.pos_detail_1], reading: item.reading ?? '', readingKind: 'kana' })))
    .map(({ word, pos, reading }) => {
      const furigana = overrides[text]?.[word] ?? reading;
      return { word, pos, furigana, romaji: getLocalRomaji(word, furigana, pos) };
    });
  if (!hasDailySentenceReadings({ text, tokens })) throw new Error(`Missing or misaligned readings: ${text}`);
  return tokens;
}
