import type { TokenData } from '../services/api';
import type { Locale } from '../i18n';

export type SentenceLicense = 'CC BY 2.0 FR' | 'CC0 1.0';
export interface SentenceAttribution { id: number; license: SentenceLicense; owner?: string; }

export interface DailySentence {
  /** 日本时间日期 YYYY-MM-DD；备用句没有 */
  date?: string;
  text: string;
  tokens: TokenData[];
  translation: Partial<Record<Locale, string>>;
  source?: { provider: 'tatoeba'; id: number; license: SentenceLicense; owner?: string; translations: Partial<Record<Locale, SentenceAttribution>> };
}

// 首页离线句库：预先分词、注音并提供四种译文，不调用 AI。
const t = (word: string, pos: string, furigana?: string): TokenData => ({ word, pos, furigana });
const P = (word: string) => t(word, '記号');
const s = (tokens: TokenData[], zh: string, tw: string, en: string, ko: string): DailySentence => ({
  text: tokens.map(token => token.word).join(''), tokens, translation: { 'zh-CN': zh, 'zh-TW': tw, en, ko },
});

export const DAILY_SENTENCES: DailySentence[] = [
  {
    text: '天気がいいから、散歩しましょう。',
    tokens: [t('天気', '名詞', 'てんき'), t('が', '助詞'), t('いい', '形容詞'), t('から', '助詞'), P('、'), t('散歩', '名詞', 'さんぽ'), t('し', '動詞'), t('ましょう', '助動詞'), P('。')],
    translation: { 'zh-CN': '天气很好，去散步吧。', 'zh-TW': '天氣很好，去散步吧。', en: "The weather's nice, so let's take a walk.", ko: '날씨가 좋으니까 산책합시다.' },
  },
  {
    text: '猫が窓の外を見ている。',
    tokens: [t('猫', '名詞', 'ねこ'), t('が', '助詞'), t('窓', '名詞', 'まど'), t('の', '助詞'), t('外', '名詞', 'そと'), t('を', '助詞'), t('見', '動詞', 'み'), t('て', '助詞'), t('いる', '動詞'), P('。')],
    translation: { 'zh-CN': '猫正看着窗外。', 'zh-TW': '貓正看著窗外。', en: 'The cat is looking out the window.', ko: '고양이가 창밖을 보고 있다.' },
  },
  {
    text: '明日は雨が降るそうです。',
    tokens: [t('明日', '名詞', 'あした'), t('は', '助詞'), t('雨', '名詞', 'あめ'), t('が', '助詞'), t('降る', '動詞', 'ふる'), t('そう', '助動詞'), t('です', '助動詞'), P('。')],
    translation: { 'zh-CN': '听说明天会下雨。', 'zh-TW': '聽說明天會下雨。', en: "I hear it's going to rain tomorrow.", ko: '내일은 비가 온대요.' },
  },
  {
    text: '春になると、桜が咲きます。',
    tokens: [t('春', '名詞', 'はる'), t('に', '助詞'), t('なる', '動詞'), t('と', '助詞'), P('、'), t('桜', '名詞', 'さくら'), t('が', '助詞'), t('咲き', '動詞', 'さき'), t('ます', '助動詞'), P('。')],
    translation: { 'zh-CN': '一到春天，樱花就会开。', 'zh-TW': '一到春天，櫻花就會開。', en: 'When spring comes, the cherry blossoms bloom.', ko: '봄이 되면 벚꽃이 핍니다.' },
  },
  {
    text: '駅まで歩いて十分ぐらいです。',
    tokens: [t('駅', '名詞', 'えき'), t('まで', '助詞'), t('歩い', '動詞', 'あるい'), t('て', '助詞'), t('十分', '名詞', 'じゅっぷん'), t('ぐらい', '助詞'), t('です', '助動詞'), P('。')],
    translation: { 'zh-CN': '走到车站大约十分钟。', 'zh-TW': '走到車站大約十分鐘。', en: "It's about a ten-minute walk to the station.", ko: '역까지 걸어서 10분 정도예요.' },
  },
  {
    text: '少しずつ上手になっていますね。',
    tokens: [t('少し', '副詞', 'すこし'), t('ずつ', '助詞'), t('上手', '形容動詞', 'じょうず'), t('に', '助動詞'), t('なっ', '動詞'), t('て', '助詞'), t('い', '動詞'), t('ます', '助動詞'), t('ね', '助詞'), P('。')],
    translation: { 'zh-CN': '你在一点点进步呢。', 'zh-TW': '你在一點一點進步呢。', en: "You're getting better little by little.", ko: '조금씩 능숙해지고 있네요.' },
  },
  {
    text: 'この本はとても面白かった。',
    tokens: [t('この', '連体詞'), t('本', '名詞', 'ほん'), t('は', '助詞'), t('とても', '副詞'), t('面白かっ', '形容詞', 'おもしろかっ'), t('た', '助動詞'), P('。')],
    translation: { 'zh-CN': '这本书非常有趣。', 'zh-TW': '這本書非常有趣。', en: 'This book was really interesting.', ko: '이 책은 정말 재미있었다.' },
  },
  s([t('毎朝', '名詞', 'まいあさ'), t('温かい', '形容詞', 'あたたかい'), t('お茶', '名詞', 'おちゃ'), t('を', '助詞'), t('飲み', '動詞', 'のみ'), t('ます', '助動詞'), P('。')], '每天早上喝热茶。', '每天早上喝熱茶。', 'I drink warm tea every morning.', '매일 아침 따뜻한 차를 마셔요.'),
  s([t('窓', '名詞', 'まど'), t('を', '助詞'), t('開ける', '動詞', 'あける'), t('と', '助詞'), t('涼しい', '形容詞', 'すずしい'), t('風', '名詞', 'かぜ'), t('が', '助詞'), t('入り', '動詞', 'はいり'), t('ます', '助動詞'), P('。')], '打开窗户，凉风吹了进来。', '打開窗戶，涼風吹了進來。', 'A cool breeze comes in when I open the window.', '창문을 열면 시원한 바람이 들어와요.'),
  s([t('朝ご飯', '名詞', 'あさごはん'), t('を', '助詞'), t('食べ', '動詞', 'たべ'), t('て', '助詞'), t('から', '助詞'), t('出かけ', '動詞', 'でかけ'), t('ます', '助動詞'), P('。')], '吃完早饭再出门。', '吃完早飯再出門。', 'I go out after eating breakfast.', '아침을 먹고 나서 외출해요.'),
  s([t('今日', '名詞', 'きょう'), t('は', '助詞'), t('いつも', '副詞'), t('より', '助詞'), t('早く', '形容詞', 'はやく'), t('起き', '動詞', 'おき'), t('まし', '助動詞'), t('た', '助動詞'), P('。')], '今天比平时起得早。', '今天比平時起得早。', 'I got up earlier than usual today.', '오늘은 평소보다 일찍 일어났어요.'),
  s([t('寝る', '動詞', 'ねる'), t('前', '名詞', 'まえ'), t('に', '助詞'), t('少し', '副詞', 'すこし'), t('本', '名詞', 'ほん'), t('を', '助詞'), t('読み', '動詞', 'よみ'), t('ます', '助動詞'), P('。')], '睡前读一会儿书。', '睡前讀一會兒書。', 'I read a little before going to bed.', '자기 전에 책을 조금 읽어요.'),
  s([t('疲れ', '動詞', 'つかれ'), t('た', '助動詞'), t('とき', '名詞'), t('は', '助詞'), t('ゆっくり', '副詞'), t('休ん', '動詞', 'やすん'), t('で', '助詞'), t('ください', '動詞'), P('。')], '累的时候请好好休息。', '累的時候請好好休息。', 'Please get some rest when you are tired.', '피곤할 때는 푹 쉬세요.'),
  s([t('毎日', '名詞', 'まいにち'), t('少し', '副詞', 'すこし'), t('ずつ', '助詞'), t('日本語', '名詞', 'にほんご'), t('を', '助詞'), t('勉強', '名詞', 'べんきょう'), t('し', '動詞'), t('て', '助詞'), t('い', '動詞'), t('ます', '助動詞'), P('。')], '每天都学一点日语。', '每天都學一點日語。', 'I study a little Japanese every day.', '매일 일본어를 조금씩 공부하고 있어요.'),
  s([t('分から', '動詞', 'わから'), t('ない', '助動詞'), t('言葉', '名詞', 'ことば'), t('は', '助詞'), t('辞書', '名詞', 'じしょ'), t('で', '助詞'), t('調べ', '動詞', 'しらべ'), t('ます', '助動詞'), P('。')], '不懂的词用词典查。', '不懂的詞用詞典查。', 'I look up unfamiliar words in a dictionary.', '모르는 단어는 사전에서 찾아봐요.'),
  s([t('この', '連体詞'), t('漢字', '名詞', 'かんじ'), t('の', '助詞'), t('読み方', '名詞', 'よみかた'), t('を', '助詞'), t('教え', '動詞', 'おしえ'), t('て', '助詞'), t('ください', '動詞'), P('。')], '请告诉我这个汉字怎么读。', '請告訴我這個漢字怎麼讀。', 'Please tell me how to read this kanji.', '이 한자를 어떻게 읽는지 알려 주세요.'),
  s([t('何度', '名詞', 'なんど'), t('も', '助詞'), t('聞く', '動詞', 'きく'), t('と', '助詞'), t('覚え', '動詞', 'おぼえ'), t('やすく', '形容詞'), t('なり', '動詞'), t('ます', '助動詞'), P('。')], '反复听就更容易记住。', '反覆聽就更容易記住。', 'Listening repeatedly makes it easier to remember.', '여러 번 들으면 외우기 쉬워져요.'),
  s([t('間違え', '動詞', 'まちがえ'), t('て', '助詞'), t('も', '助詞'), t('大丈夫', '形容動詞', 'だいじょうぶ'), t('です', '助動詞'), t('よ', '助詞'), P('。')], '弄错了也没关系。', '弄錯了也沒關係。', 'It is okay to make mistakes.', '틀려도 괜찮아요.'),
  s([t('一緒', '名詞', 'いっしょ'), t('に', '助詞'), t('声', '名詞', 'こえ'), t('に', '助詞'), t('出し', '動詞', 'だし'), t('て', '助詞'), t('読ん', '動詞', 'よん'), t('で', '助詞'), t('み', '動詞'), t('ましょう', '助動詞'), P('。')], '一起试着读出声来吧。', '一起試著讀出聲來吧。', 'Let us try reading it aloud together.', '함께 소리 내어 읽어 봐요.'),
  s([t('次', '名詞', 'つぎ'), t('の', '助詞'), t('電車', '名詞', 'でんしゃ'), t('は', '助詞'), t('すぐ', '副詞'), t('に', '助詞'), t('来', '動詞', 'き'), t('ます', '助動詞'), P('。')], '下一班电车马上就来。', '下一班電車馬上就來。', 'The next train will arrive soon.', '다음 전철은 곧 와요.'),
  s([t('駅', '名詞', 'えき'), t('の', '助詞'), t('前', '名詞', 'まえ'), t('で', '助詞'), t('友達', '名詞', 'ともだち'), t('を', '助詞'), t('待っ', '動詞', 'まっ'), t('て', '助詞'), t('い', '動詞'), t('ます', '助動詞'), P('。')], '正在车站前等朋友。', '正在車站前等朋友。', 'I am waiting for a friend in front of the station.', '역 앞에서 친구를 기다리고 있어요.'),
  s([t('この', '連体詞'), t('道', '名詞', 'みち'), t('を', '助詞'), t('まっすぐ', '副詞'), t('進ん', '動詞', 'すすん'), t('で', '助詞'), t('ください', '動詞'), P('。')], '请沿着这条路直走。', '請沿著這條路直走。', 'Please go straight along this road.', '이 길을 곧장 가세요.'),
  s([t('今日', '名詞', 'きょう'), t('は', '助詞'), t('自転車', '名詞', 'じてんしゃ'), t('で', '助詞'), t('学校', '名詞', 'がっこう'), t('へ', '助詞'), t('行き', '動詞', 'いき'), t('ます', '助動詞'), P('。')], '今天骑自行车去学校。', '今天騎自行車去學校。', 'I am going to school by bicycle today.', '오늘은 자전거로 학교에 가요.'),
  s([t('急が', '動詞', 'いそが'), t('なく', '助動詞'), t('て', '助詞'), t('も', '助詞'), t('間に合い', '動詞', 'まにあい'), t('ます', '助動詞'), P('。')], '不用着急也来得及。', '不用著急也來得及。', 'We will make it in time without rushing.', '서두르지 않아도 시간에 맞출 수 있어요.'),
  s([t('帰り', '名詞', 'かえり'), t('に', '助詞'), t('買い物', '名詞', 'かいもの'), t('を', '助詞'), t('し', '動詞'), t('て', '助詞'), t('帰り', '動詞', 'かえり'), t('ます', '助動詞'), P('。')], '回去的路上买点东西。', '回去的路上買點東西。', 'I will do some shopping on the way home.', '돌아가는 길에 장을 보고 집에 가요.'),
  s([t('今夜', '名詞', 'こんや'), t('は', '助詞'), t('家', '名詞', 'いえ'), t('で', '助詞'), t('料理', '名詞', 'りょうり'), t('を', '助詞'), t('作り', '動詞', 'つくり'), t('ます', '助動詞'), P('。')], '今晚在家做饭。', '今晚在家做飯。', 'I will cook at home tonight.', '오늘 밤은 집에서 요리해요.'),
  s([t('この', '連体詞'), t('店', '名詞', 'みせ'), t('の', '助詞'), t('パン', '名詞'), t('は', '助詞'), t('とても', '副詞'), t('おいしい', '形容詞'), t('です', '助動詞'), P('。')], '这家店的面包很好吃。', '這家店的麵包很好吃。', 'The bread at this shop is delicious.', '이 가게의 빵은 정말 맛있어요.'),
  s([t('もう', '副詞'), t('少し', '副詞', 'すこし'), t('水', '名詞', 'みず'), t('を', '助詞'), t('入れ', '動詞', 'いれ'), t('て', '助詞'), t('ください', '動詞'), P('。')], '请再加一点水。', '請再加一點水。', 'Please add a little more water.', '물을 조금 더 넣어 주세요.'),
  s([t('野菜', '名詞', 'やさい'), t('を', '助詞'), t('よく', '副詞'), t('洗っ', '動詞', 'あらっ'), t('て', '助詞'), t('から', '助詞'), t('切り', '動詞', 'きり'), t('ます', '助動詞'), P('。')], '把蔬菜洗干净后再切。', '把蔬菜洗乾淨後再切。', 'I wash the vegetables thoroughly before cutting them.', '채소를 깨끗이 씻고 나서 썰어요.'),
  s([t('温かい', '形容詞', 'あたたかい'), t('スープ', '名詞'), t('を', '助詞'), t('飲む', '動詞', 'のむ'), t('と', '助詞'), t('ほっと', '副詞'), t('し', '動詞'), t('ます', '助動詞'), P('。')], '喝点热汤就觉得放松了。', '喝點熱湯就覺得放鬆了。', 'Drinking warm soup makes me feel at ease.', '따뜻한 수프를 마시면 마음이 놓여요.'),
  s([t('お腹', '名詞', 'おなか'), t('が', '助詞'), t('すい', '動詞'), t('た', '助動詞'), t('ので', '助詞'), t('何か', '代名詞', 'なにか'), t('食べ', '動詞', 'たべ'), t('ましょう', '助動詞'), P('。')], '肚子饿了，吃点东西吧。', '肚子餓了，吃點東西吧。', 'I am hungry, so let us eat something.', '배가 고프니 뭐 좀 먹어요.'),
  s([t('週末', '名詞', 'しゅうまつ'), t('は', '助詞'), t('友達', '名詞', 'ともだち'), t('と', '助詞'), t('映画', '名詞', 'えいが'), t('を', '助詞'), t('見', '動詞', 'み'), t('ます', '助動詞'), P('。')], '周末和朋友看电影。', '週末和朋友看電影。', 'I watch movies with friends on weekends.', '주말에는 친구와 영화를 봐요.'),
  s([t('久しぶり', '名詞', 'ひさしぶり'), t('に', '助詞'), t('家族', '名詞', 'かぞく'), t('と', '助詞'), t('話し', '動詞', 'はなし'), t('まし', '助動詞'), t('た', '助動詞'), P('。')], '好久没和家人聊天了，这次聊了聊。', '好久沒和家人聊天了，這次聊了聊。', 'I talked with my family for the first time in a while.', '오랜만에 가족과 이야기를 나눴어요.'),
  s([t('一緒', '名詞', 'いっしょ'), t('に', '助詞'), t('写真', '名詞', 'しゃしん'), t('を', '助詞'), t('撮っ', '動詞', 'とっ'), t('て', '助詞'), t('も', '助詞'), t('いい', '形容詞'), t('です', '助動詞'), t('か', '助詞'), P('。')], '可以一起拍张照片吗？', '可以一起拍張照片嗎？', 'May we take a photo together?', '같이 사진을 찍어도 될까요?'),
  s([t('また', '副詞'), t('会える', '動詞', 'あえる'), t('日', '名詞', 'ひ'), t('を', '助詞'), t('楽しみ', '名詞', 'たのしみ'), t('に', '助詞'), t('し', '動詞'), t('て', '助詞'), t('い', '動詞'), t('ます', '助動詞'), P('。')], '期待再次见面的那一天。', '期待再次見面的那一天。', 'I look forward to the day we can meet again.', '다시 만날 날을 기대하고 있어요.'),
  s([t('困っ', '動詞', 'こまっ'), t('た', '助動詞'), t('とき', '名詞'), t('は', '助詞'), t('いつでも', '副詞'), t('相談', '名詞', 'そうだん'), t('し', '動詞'), t('て', '助詞'), t('ください', '動詞'), P('。')], '遇到困难时随时来商量。', '遇到困難時隨時來商量。', 'Please talk to me whenever you need help.', '곤란할 때는 언제든지 상의해 주세요.'),
  s([t('手伝っ', '動詞', 'てつだっ'), t('て', '助詞'), t('くれ', '動詞'), t('て', '助詞'), t('ありがとう', '感動詞'), P('。')], '谢谢你帮忙。', '謝謝你幫忙。', 'Thank you for helping me.', '도와줘서 고마워요.'),
  s([t('公園', '名詞', 'こうえん'), t('の', '助詞'), t('花', '名詞', 'はな'), t('が', '助詞'), t('きれい', '形容動詞'), t('に', '助動詞'), t('咲い', '動詞', 'さい'), t('て', '助詞'), t('い', '動詞'), t('ます', '助動詞'), P('。')], '公园里的花开得很美。', '公園裡的花開得很美。', 'The flowers in the park are blooming beautifully.', '공원에 꽃이 예쁘게 피어 있어요.'),
  s([t('雨', '名詞', 'あめ'), t('が', '助詞'), t('やん', '動詞'), t('だら', '助動詞'), t('外', '名詞', 'そと'), t('へ', '助詞'), t('出', '動詞', 'で'), t('ましょう', '助動詞'), P('。')], '雨停了就出去吧。', '雨停了就出去吧。', 'Let us go outside when the rain stops.', '비가 그치면 밖에 나가요.'),
  s([t('秋', '名詞', 'あき'), t('の', '助詞'), t('空', '名詞', 'そら'), t('は', '助詞'), t('高く', '形容詞', 'たかく'), t('見え', '動詞', 'みえ'), t('ます', '助動詞'), P('。')], '秋天的天空显得很高。', '秋天的天空顯得很高。', 'The autumn sky looks high.', '가을 하늘은 높아 보여요.'),
  s([t('寒い', '形容詞', 'さむい'), t('ので', '助詞'), t('上着', '名詞', 'うわぎ'), t('を', '助詞'), t('持っ', '動詞', 'もっ'), t('て', '助詞'), t('いき', '動詞'), t('ます', '助動詞'), P('。')], '天气冷，带件外套去。', '天氣冷，帶件外套去。', 'It is cold, so I am taking a jacket.', '추워서 겉옷을 가져가요.'),
  s([t('日', '名詞', 'ひ'), t('が', '助詞'), t('長く', '形容詞', 'ながく'), t('なっ', '動詞'), t('て', '助詞'), t('き', '動詞'), t('まし', '助動詞'), t('た', '助動詞'), t('ね', '助詞'), P('。')], '白天渐渐变长了呢。', '白天漸漸變長了呢。', 'The days are getting longer, are they not?', '해가 점점 길어졌네요.'),
  s([t('山', '名詞', 'やま'), t('の', '助詞'), t('空気', '名詞', 'くうき'), t('は', '助詞'), t('とても', '副詞'), t('気持ち', '名詞', 'きもち'), t('が', '助詞'), t('いい', '形容詞'), t('です', '助動詞'), P('。')], '山里的空气让人很舒服。', '山裡的空氣讓人很舒服。', 'The mountain air feels wonderful.', '산 공기가 정말 상쾌해요.'),
  s([t('休み', '名詞', 'やすみ'), t('の', '助詞'), t('日', '名詞', 'ひ'), t('は', '助詞'), t('よく', '副詞'), t('音楽', '名詞', 'おんがく'), t('を', '助詞'), t('聞き', '動詞', 'きき'), t('ます', '助動詞'), P('。')], '休息日经常听音乐。', '休息日經常聽音樂。', 'I often listen to music on my days off.', '쉬는 날에는 음악을 자주 들어요.'),
  s([t('新しい', '形容詞', 'あたらしい'), t('趣味', '名詞', 'しゅみ'), t('を', '助詞'), t('見つけ', '動詞', 'みつけ'), t('たい', '助動詞'), t('です', '助動詞'), P('。')], '想找到一个新爱好。', '想找到一個新愛好。', 'I want to find a new hobby.', '새로운 취미를 찾고 싶어요.'),
  s([t('図書館', '名詞', 'としょかん'), t('で', '助詞'), t('静か', '形容動詞', 'しずか'), t('に', '助動詞'), t('本', '名詞', 'ほん'), t('を', '助詞'), t('読み', '動詞', 'よみ'), t('まし', '助動詞'), t('た', '助動詞'), P('。')], '在图书馆安静地读了书。', '在圖書館安靜地讀了書。', 'I read quietly at the library.', '도서관에서 조용히 책을 읽었어요.'),
  s([t('この', '連体詞'), t('歌', '名詞', 'うた'), t('を', '助詞'), t('聞く', '動詞', 'きく'), t('と', '助詞'), t('元気', '名詞', 'げんき'), t('に', '助詞'), t('なり', '動詞'), t('ます', '助動詞'), P('。')], '听到这首歌就精神起来了。', '聽到這首歌就精神起來了。', 'This song cheers me up.', '이 노래를 들으면 힘이 나요.'),
  s([t('今度', '名詞', 'こんど'), t('の', '助詞'), t('旅行', '名詞', 'りょこう'), t('が', '助詞'), t('楽しみ', '名詞', 'たのしみ'), t('です', '助動詞'), P('。')], '很期待接下来的旅行。', '很期待接下來的旅行。', 'I am looking forward to the next trip.', '다가오는 여행이 기대돼요.'),
  s([t('知ら', '動詞', 'しら'), t('ない', '助動詞'), t('町', '名詞', 'まち'), t('を', '助詞'), t('歩く', '動詞', 'あるく'), t('の', '助詞'), t('が', '助詞'), t('好き', '形容動詞', 'すき'), t('です', '助動詞'), P('。')], '喜欢在陌生的小镇里走走。', '喜歡在陌生的小鎮裡走走。', 'I like walking around unfamiliar towns.', '낯선 동네를 걷는 것을 좋아해요.'),
  s([t('部屋', '名詞', 'へや'), t('を', '助詞'), t('片づける', '動詞', 'かたづける'), t('と', '助詞'), t('気分', '名詞', 'きぶん'), t('が', '助詞'), t('いい', '形容詞'), t('です', '助動詞'), P('。')], '收拾好房间后心情很舒畅。', '收拾好房間後心情很舒暢。', 'Tidying my room makes me feel good.', '방을 정리하면 기분이 좋아요.'),
  s([t('忘れ物', '名詞', 'わすれもの'), t('が', '助詞'), t('ない', '形容詞'), t('か', '助詞'), t('確かめ', '動詞', 'たしかめ'), t('ましょう', '助動詞'), P('。')], '确认一下有没有忘带东西吧。', '確認一下有沒有忘帶東西吧。', 'Let us check that we have not forgotten anything.', '빠뜨린 물건이 없는지 확인해 봐요.'),
  s([t('鍵', '名詞', 'かぎ'), t('は', '助詞'), t('机', '名詞', 'つくえ'), t('の', '助詞'), t('上', '名詞', 'うえ'), t('に', '助詞'), t('置い', '動詞', 'おい'), t('て', '助詞'), t('あり', '動詞'), t('ます', '助動詞'), P('。')], '钥匙放在桌子上。', '鑰匙放在桌子上。', 'The key has been left on the desk.', '열쇠는 책상 위에 놓여 있어요.'),
  s([t('忙しい', '形容詞', 'いそがしい'), t('とき', '名詞'), t('ほど', '助詞'), t('落ち着い', '動詞', 'おちつい'), t('て', '助詞'), t('行動', '名詞', 'こうどう'), t('し', '動詞'), t('ましょう', '助動詞'), P('。')], '越忙越要沉着行动。', '越忙越要沉著行動。', 'The busier we are, the more calmly we should act.', '바쁠수록 침착하게 행동해요.'),
  s([t('今日', '名詞', 'きょう'), t('の', '助詞'), t('仕事', '名詞', 'しごと'), t('は', '助詞'), t('もう', '副詞'), t('終わり', '動詞', 'おわり'), t('まし', '助動詞'), t('た', '助動詞'), P('。')], '今天的工作已经完成了。', '今天的工作已經完成了。', 'I have already finished today’s work.', '오늘 일은 이미 끝났어요.'),
  s([t('少し', '副詞', 'すこし'), t('休ん', '動詞', 'やすん'), t('で', '助詞'), t('から', '助詞'), t('続け', '動詞', 'つづけ'), t('ましょう', '助動詞'), P('。')], '稍微休息一下再继续吧。', '稍微休息一下再繼續吧。', 'Let us take a short break before continuing.', '조금 쉬고 나서 계속해요.'),
  s([t('無理', '名詞', 'むり'), t('を', '助詞'), t('せ', '動詞'), t('ず', '助動詞'), t('自分', '名詞', 'じぶん'), t('の', '助詞'), t('ペース', '名詞'), t('で', '助詞'), t('進み', '動詞', 'すすみ'), t('ましょう', '助動詞'), P('。')], '不要勉强，按自己的节奏前进吧。', '不要勉強，按自己的節奏前進吧。', 'Do not push yourself; go at your own pace.', '무리하지 말고 자신의 속도로 나아가요.'),
  s([t('毎日', '名詞', 'まいにち'), t('歩く', '動詞', 'あるく'), t('よう', '名詞'), t('に', '助詞'), t('し', '動詞'), t('て', '助詞'), t('い', '動詞'), t('ます', '助動詞'), P('。')], '尽量坚持每天走路。', '盡量堅持每天走路。', 'I make a point of walking every day.', '매일 걸으려고 노력하고 있어요.'),
  s([t('早く', '形容詞', 'はやく'), t('寝る', '動詞', 'ねる'), t('と', '助詞'), t('朝', '名詞', 'あさ'), t('が', '助詞'), t('楽', '形容動詞', 'らく'), t('に', '助動詞'), t('なり', '動詞'), t('ます', '助動詞'), P('。')], '早点睡，早上就轻松了。', '早點睡，早上就輕鬆了。', 'Going to bed early makes mornings easier.', '일찍 자면 아침이 한결 편해져요.'),
  s([t('今日', '名詞', 'きょう'), t('も', '助詞'), t('いい', '形容詞'), t('一日', '名詞', 'いちにち'), t('に', '助詞'), t('なり', '動詞'), t('ます', '助動詞'), t('よう', '名詞'), t('に', '助詞'), P('。')], '愿今天也是美好的一天。', '願今天也是美好的一天。', 'May today be another good day.', '오늘도 좋은 하루가 되기를 바라요.'),
  s([t('小さな', '連体詞', 'ちいさな'), t('こと', '名詞'), t('から', '助詞'), t('始め', '動詞', 'はじめ'), t('て', '助詞'), t('み', '動詞'), t('ましょう', '助動詞'), P('。')], '试着从小事开始吧。', '試著從小事開始吧。', 'Let us try starting with something small.', '작은 일부터 시작해 봐요.'),
];

/** 「今日」按日本时间计算，日本零点换句 */
export function getJstDateKey(date = new Date()): string {
  // en-CA 的日期格式正好是 YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(date);
}

/** 日期键 → 连续天数，用于在各种列表里轮换 */
export function getDayNumber(dateKey: string): number {
  return Math.floor(Date.parse(`${dateKey}T00:00:00Z`) / 86_400_000);
}

/** 离日本时间下一个零点还有多少秒 */
export function secondsUntilJstMidnight(date = new Date()): number {
  const jstMs = date.getTime() + 9 * 3_600_000;
  return Math.max(0, Math.floor((86_400_000 - (jstMs % 86_400_000)) / 1000));
}

/** 存储不可用时的确定性兜底：同一天刷新仍显示同一句 */
export function getFallbackDailySentence(date = new Date()): DailySentence {
  return DAILY_SENTENCES[getDayNumber(getJstDateKey(date)) % DAILY_SENTENCES.length];
}

export function isSentenceLicense(value: unknown): value is SentenceLicense {
  return value === 'CC BY 2.0 FR' || value === 'CC0 1.0';
}

export function isDailySentenceText(value: unknown): value is string {
  return typeof value === 'string' && Array.from(value).length >= 10 && Array.from(value).length <= 40
    && /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々、！？。]+。$/u.test(value)
    && !/[。！？]/u.test(value.slice(0, -1)) && /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value);
}

export function isSentenceAttribution(value: unknown): value is SentenceAttribution {
  if (!value || typeof value !== 'object') return false;
  const item = value as SentenceAttribution;
  return Number.isSafeInteger(item.id) && item.id > 0 && isSentenceLicense(item.license);
}

/** Readings must cover every kanji and tokens must reconstruct the original exactly. */
export function hasDailySentenceReadings(value: unknown): value is Pick<DailySentence, 'text' | 'tokens'> {
  if (!value || typeof value !== 'object') return false;
  const item = value as DailySentence;
  return typeof item.text === 'string' && Array.isArray(item.tokens) && item.tokens.length > 0
    && item.tokens.length <= item.text.length && item.tokens.every(token => token && typeof token.word === 'string'
      && token.word.length > 0 && typeof token.pos === 'string'
      && (token.furigana === undefined || (typeof token.furigana === 'string' && token.furigana.length <= 160
        && (token.furigana === '' || /^[\p{Script=Hiragana}\p{Script=Katakana}ー]+$/u.test(token.furigana))))
      && (!/[\p{Script=Han}々]/u.test(token.word) || !!token.furigana))
    && item.tokens.map(token => token.word).join('') === item.text;
}

/** A candidate becomes a learning example only with readings and the requested translation. */
export function isCompleteDailySentence(sentence: DailySentence, locale: Locale): boolean {
  return hasDailySentenceReadings(sentence) && typeof sentence.translation?.[locale] === 'string'
    && !!sentence.translation[locale]?.trim();
}

/** Validate untrusted network/cache data before rendering or building source links. */
export function isOnlineDailySentence(value: unknown): value is DailySentence & { source: NonNullable<DailySentence['source']> } {
  if (!value || typeof value !== 'object') return false;
  const item = value as DailySentence;
  if (!isDailySentenceText(item.text) || typeof item.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(item.date)
    || !Array.isArray(item.tokens) || (item.tokens.length !== 0 && !hasDailySentenceReadings(item)) || !item.source || item.source.provider !== 'tatoeba'
    || !isSentenceAttribution(item.source) || !item.source.translations || typeof item.source.translations !== 'object'
    || !item.translation || typeof item.translation !== 'object' || Array.isArray(item.translation)) return false;
  return Object.entries(item.translation).every(([locale, text]) => ['zh-CN', 'zh-TW', 'en', 'ko'].includes(locale)
    && typeof text === 'string' && text.trim().length > 0 && text.length <= 240 && !/[<>\r\n]/.test(text)
    && isSentenceAttribution(item.source!.translations[locale as Locale]));
}

export function sentenceLicenseUrl(license: SentenceLicense): string {
  return license === 'CC0 1.0' ? 'https://creativecommons.org/publicdomain/zero/1.0/' : 'https://creativecommons.org/licenses/by/2.0/fr/';
}
