import type { Locale } from '../i18n';

// Adapted for Japanese learning from MQM accuracy, terminology, style and locale dimensions:
// https://www.themqm.org/mqm-pillars/the-mqm-core-typology/
// Shared by first-pass translation and post-editing to keep their criteria consistent.
const qualityRules: Record<Locale, string> = {
  'zh-CN': `翻译准则（按优先级执行）：忠实准确 > 自然通顺 > 契合原文的文体之美。“雅”是风格得体，不是一律文艺化。
1. 语义完整：准确传达谁对谁做什么，核对否定及其范围、数量与限定、时态与体、条件与因果、转折、推测与传闻、意愿与义务，以及被动、使役和授受关系。不得漏译、增添事实或改变确定程度；忠实不等于逐词照搬。
2. 语境与歧义：仅依据提供的日文上下文消解省略和指代。证据不足时保留原文的模糊程度，不擅自补出性别、身份、人物关系或动机；目标语语法确需补足时，采用假设最少的自然表达，不罗列多个猜测。
3. 日语辨义：根据实际用法判断多义词、惯用语和句式。例如「〜と」可能表示条件、先后发现、引用或并列，须先辨义再表达；可按语境使用“一……就……”等自然译法，也可不用，不强制套用或一概禁止。区分部分否定与全盘否定、传闻与外观判断，不把推测译成事实。
4. 文体与语气：保留原文的正式程度、敬意、情绪强弱、人物口吻及有意义的意象、重复和含蓄。口语自然，说明文清楚，文学表达可凝练传神；不凭空加诗意、修辞、解释或感叹，也不把书面语随意改成闲聊。惯用语以语境含义和语气为准，避免生硬直译。
5. 术语与细节：同一指称与术语保持一致，按语境采用可靠的通行译名；无把握时保留姓名或专名的原写法，不臆造读音。准确保留数字、日期、单位和专名所指，不擅自换算币种或单位。语序、标点和搭配遵循目标语习惯。
6. 结构与自检：严格对应原文各行，保留所有换行、空行、段落及其顺序；不合并、拆分或跨行搬移内容。输出前默默对照原文检查意义、语气、术语和格式，只输出任务要求的结果。`,
  'zh-TW': `翻譯準則（依優先順序執行）：忠實準確 > 自然通順 > 契合原文的文體之美。「雅」是風格得體，不是一律文藝化。
1. 語意完整：準確傳達誰對誰做什麼，核對否定及其範圍、數量與限定、時態與體、條件與因果、轉折、推測與傳聞、意願與義務，以及被動、使役和授受關係。不得漏譯、增添事實或改變確定程度；忠實不等於逐字照搬。
2. 語境與歧義：僅依提供的日文上下文判斷省略與指涉。證據不足時保留原文的模糊程度，不自行補出性別、身分、人物關係或動機；目標語文法確需補足時，採取預設最少的自然表達，不列出多個猜測。
3. 日語辨義：依實際用法判斷多義詞、慣用語與句型。例如「〜と」可能表示條件、先後發現、引用或並列，須先辨義再表達；可依語境使用「一……就……」等自然譯法，也可不用，不強制套用或一概禁止。區分部分否定與全盤否定、傳聞與外觀判斷，不把推測譯成事實。
4. 文體與語氣：保留原文的正式程度、敬意、情緒強弱、人物口吻及有意義的意象、重複和含蓄。口語自然，說明文清楚，文學表達可凝練傳神；不憑空加詩意、修辭、解釋或感嘆，也不將書面語隨意改成閒聊。慣用語以語境含義與語氣為準，避免生硬直譯。
5. 術語與細節：同一指稱與術語保持一致，依語境採用可靠的通行譯名；無把握時保留姓名或專名的原寫法，不臆造讀音。準確保留數字、日期、單位及專名所指，不自行換算幣別或單位。語序、標點及搭配遵循臺灣繁體中文習慣。
6. 結構與自我檢查：嚴格對應原文各行，保留所有換行、空行、段落及其順序；不合併、拆分或跨行搬移內容。輸出前默默對照原文檢查語意、語氣、術語與格式，只輸出任務要求的結果。`,
  en: `Translation criteria, in priority order: fidelity > natural fluency > style appropriate to the source. Elegance means fitting the source, not making every sentence literary.
1. Meaning: Preserve who does what to whom, negation and its scope, quantities and qualifiers, tense and aspect, conditions and causality, contrast, uncertainty and hearsay, intention and obligation, and passive, causative and giving/receiving relations. Do not omit meaning, add facts or change certainty. Fidelity does not require word-for-word syntax.
2. Context and ambiguity: Resolve omitted subjects and references only from the supplied Japanese context. Where evidence is insufficient, preserve ambiguity; do not invent gender, identities, relationships or motives. If target grammar requires an explicit choice, use the least assumptive natural wording, without listing guesses or alternatives.
3. Japanese distinctions: Interpret polysemy, idioms and constructions in context. For example, 〜と can mark a condition, a subsequent discovery, a quotation or coordination; distinguish these before choosing wording. Use expressions such as “when” or “as soon as” only when appropriate, without mandatory templates or blanket bans. Distinguish partial from total negation and hearsay from observed appearance; do not turn conjecture into fact.
4. Register and voice: Match formality, politeness, emotional intensity, speaker voice and meaningful imagery, repetition and understatement. Keep conversation conversational, exposition clear and literary passages appropriately expressive. Do not add poetic embellishment, explanations or exclamations, or turn written prose into casual chatter. Render idioms by contextual meaning and force rather than literal wording.
5. Terms and details: Keep names, referents and terminology consistent. Use established translations where reliable; otherwise retain the original name rather than inventing its reading. Preserve numerical values, dates, units and named entities; do not convert currencies or units without a request. Follow natural target-language syntax, punctuation and collocations.
6. Layout and final check: Preserve exactly the original paragraph and line-break structure, including every blank line and the order of all lines. Keep each source line's content on its corresponding target line; do not merge, split or move content across lines. Silently check meaning, voice, terminology and layout against the source before returning only the requested result.`,
  ko: `번역 기준의 우선순위: 의미의 충실성 > 자연스러운 표현 > 원문에 맞는 문체. 우아함은 원문에 어울리는 표현을 뜻하며, 모든 문장을 문학적으로 꾸미라는 뜻이 아닙니다.
1. 의미: 누가 누구에게 무엇을 하는지, 부정의 범위, 수량과 한정, 시제와 상, 조건과 인과, 대조, 추측과 전문, 의지와 의무, 수동·사역·수수 관계를 정확히 보존하세요. 의미를 누락하거나 사실을 추가하거나 확실성의 정도를 바꾸지 마세요. 충실성은 단어별 직역을 뜻하지 않습니다.
2. 문맥과 모호성: 생략된 주어와 지시 대상은 제공된 일본어 문맥만으로 판단하세요. 근거가 부족하면 모호성을 유지하고 성별, 신분, 인물 관계나 동기를 지어내지 마세요. 한국어 문법상 보충이 필요하면 추정을 최소화한 자연스러운 표현을 쓰고 여러 추측이나 대안을 나열하지 마세요.
3. 일본어 구별: 다의어, 관용구와 구문은 실제 용법에 따라 해석하세요. 예를 들어 〜と는 조건, 뒤이은 발견, 인용이나 나열을 나타낼 수 있으므로 먼저 의미를 구별하세요. 특정 조건 표현을 기계적으로 강요하거나 일률적으로 금지하지 마세요. 부분 부정과 전체 부정, 전해 들은 내용과 외관에 따른 판단을 구별하고 추측을 사실로 바꾸지 마세요.
4. 문체와 어조: 격식, 존대, 감정의 강도, 화자의 말투, 의미 있는 심상·반복·여운을 보존하세요. 대화는 자연스러운 구어체로, 설명은 명확하게, 문학적 표현은 원문에 맞게 옮기세요. 시적 수식, 해설이나 감탄을 임의로 덧붙이거나 문어체를 잡담으로 바꾸지 마세요. 관용구는 직역보다 문맥상의 의미와 어감을 살리세요.
5. 용어와 세부 사항: 같은 대상과 용어의 표기를 일관되게 유지하세요. 신뢰할 수 있는 통용 번역명이 있으면 사용하되, 불확실한 이름은 독음을 지어내지 말고 원래 표기를 유지하세요. 수치, 날짜, 단위와 고유명사의 지시 대상을 정확히 보존하고 통화나 단위를 임의로 환산하지 마세요. 어순, 문장 부호와 어휘 결합은 자연스러운 한국어 관습을 따르세요.
6. 구조와 최종 확인: 원문의 각 행에 대응하여 모든 줄바꿈, 빈 줄, 문단과 순서를 그대로 보존하세요. 행을 합치거나 나누거나 다른 행으로 내용을 옮기지 마세요. 출력 전에 원문과 대조하여 의미, 어조, 용어와 형식을 내부적으로 확인하고 요청된 결과만 반환하세요.`,
};

export function getTranslationQualityPrompt(locale: Locale): string {
  return qualityRules[locale];
}
