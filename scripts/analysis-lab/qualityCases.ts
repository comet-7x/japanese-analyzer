/** Hand-authored school-grammar expectations, not model self-evaluation. */
export const qualityCases = [
  { id: 'past-verb', text: '食べた。', expected: [['食べ', '動詞', 'たべ'], ['た', '助動詞', 'た'], ['。', '記号', '']] },
  { id: 'auxiliary-verb', text: '並んでいる。', expected: [['並ん', '動詞', 'ならん'], ['で', '助詞', 'で'], ['いる', '動詞', 'いる'], ['。', '記号', '']] },
  { id: 'adjectival-noun', text: '静かだ。', expected: [['静かだ', '形容動詞', 'しずかだ'], ['。', '記号', '']] },
  { id: 'negative-auxiliary', text: '食べない。', expected: [['食べ', '動詞', 'たべ'], ['ない', '助動詞', 'ない'], ['。', '記号', '']] },
  { id: 'existential-adjective', text: 'お金がない。', expected: [['お金', '名詞', 'おかね'], ['が', '助詞', 'が'], ['ない', '形容詞', 'ない'], ['。', '記号', '']] },
  { id: 'context-today', text: '今日は晴れです。', expected: [['今日', '名詞', 'きょう'], ['は', '助詞', 'は'], ['晴れ', '名詞', 'はれ'], ['です', '助動詞', 'です'], ['。', '記号', '']] },
  { id: 'context-raw', text: '生の魚。', expected: [['生', '名詞', 'なま'], ['の', '助詞', 'の'], ['魚', '名詞', 'さかな'], ['。', '記号', '']] },
  { id: 'context-deserted', text: '人気のない道。', expected: [['人気', '名詞', 'ひとけ'], ['の', '助詞', 'の'], ['ない', '形容詞', 'ない'], ['道', '名詞', 'みち'], ['。', '記号', '']] },
  { id: 'unknown-word', text: 'ポムレリアンヌ。', expected: [['ポムレリアンヌ', '名詞', 'ぽむれりあんぬ'], ['。', '記号', '']] },
] as const;
