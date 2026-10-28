---
name: standards-zh-hans
description: >-
  Writing conventions for Simplified Chinese (mainland): typography and punctuation, numbers, words, dialogue, register, letters, 公文, academic writing, new media and AI tells.
license: MIT
metadata:
  textus-version: "1"
  textus-invocation: "hidden"
  textus-sources: "Our own text. Summarised from GB/T 15834-2011, GB/T 15835-2011, CY/T 154-2017, GB/T 9704-2012, GB/T 7713.2-2022, GB/T 7714-2025, GB/T 16159, GB/T 28039, CY/T 174 (standards, summarised only); quoted or summarised from 党政机关公文处理工作条例 (2012), 广告法, 互联网广告管理办法, 网络信息内容生态治理规定, 人工智能生成合成内容标识办法 and 国家通用语言文字法 (unprotected official texts); W3C clreq (W3C licence); ruanyf (public domain); sparanoid and Humanizer-zh (MIT, ideas)."
---

## typography
- Chinese text uses full-width ，。、；：？！（）《》“”‘’——……; English sentences and phrases inside keep English punctuation. (M) [P1; GB15834 §4; CYT154 §5]
- No space next to a full-width mark, even before or after Latin text: MacBook Air。 (M) [P2; CYT154 §8.2]
- CJK–Latin and CJK–digit spacing follow `cjk-latin-space`; never both styles in one document; keep official spellings such as 豆瓣FM. (M) [T1, T2; CYT154 §8.1; clreq §6.3.3; sparanoid; ruanyf]
- 破折号 is —— (two U+2014); --, －－, ── and a single — between Chinese clauses are wrong; a single — or ～ between numbers, dates or places is a correct range connector. (M) [P3; GB15834 §4.10, §4.13]
- 省略号 is …… (two U+2026); not ..., 。。。, a lone …, ⋯⋯, or more than one pair; twelve dots only on their own line for omitted paragraphs; English segments keep their dots. (M) [P4, T7; GB15834 §4.11, A.9.1]
- Never …… together with 等, 等等 or 什么的. (M) [P5; GB15834 A.9.2]
- Stacked ？/！: one in expository, technical and official text; [fiction] up to three for strong emotion, single first; ？！ allowed. (M) [P6; GB15834 §4.2.3.3, §4.3.3.3; sparanoid; ruanyf]
- Headings take no 。，、；： at the end (？！…… allowed); phrase-style captions take no final 。. (M) [P7, P8; GB15834 B.4, A.1]
- ？ marks interrogative mood, not the presence of a question word: 我也不知道他躲到什么地方去了。 (S) [P9]
- 、 between parallel items, English items included (Google、腾讯); ， for long items; no 、 inside approximations from adjacent numerals (三四个, 五六十岁; 二、三产业 keeps it); usually none between consecutive 《》 or “” items (warn only). (M) [P10–P12; GB15834 §4.5]
- In a 、 list closed by 以及/及, put ， before 以及. If any item contains 。, items can't end with ；. (S) [P14, P15]
- A colon follows only genuinely introductory words (据《苏州府志》载， takes a comma); no nested colons; clauses separated by ； are introduced with a colon, not a comma. (S) [P16, P32]
- Brackets: an in-sentence note follows its word and ends with no mark except ？！……; a sentence note follows the 。: （见第 26 页）。 Don't nest identical brackets; 〔〕 for document-number years, 【】 for news datelines, ［英］/〔唐〕 for nationality or dynasty. (M) [P20, P29]
- 书名号 for works, including Chinese-named software; not for brands, organisations, meetings, events or courses; a genre word stays outside (《我们》杂志); series names take “”; nested titles 《〈〉》. (S/M) [P23, P24]
- 连接号: - in codes and numeric dates (图2-8, 2011-02-15); — or ～ for ranges (1031—1095, 25～30 g); flag ASCII - used as a range in prose. (M) [P25]
- 间隔号 · (U+00B7): 让-雅克·卢梭, 《淮南子·本经训》, 安东尼·G. 普瑞斯顿; flag •, ・ or . between Chinese name parts; no 和/与 before the last ·-separated item. (M) [P26, P36; CYT154 §6]
- 分隔号 / is half-width with no point mark beside it; 着重号 is dots under characters, so use bold sparingly. (M/S) [P27, P28]
- Avoid 一逗到底; split a paragraph of commas into sentences. (S) [P30]
- Line breaking and line-end half-width compression are the renderer's job. (renderer) [P31; GB15834 §5; clreq §6]
- Full-width Latin letters and digits become half-width (Ａ１ → A1). (M) [T3]
- Straight quotes around Chinese text become “ ” and ‘ ’; never inside code, URLs or English sentences. (M) [T10; Humanizer-zh §21]
- English book and periodical titles in italics, never 《》; English article titles in “”; titles translated into Chinese take 《》. (S) [T4; CYT154 §10]
- A Chinese sentence quoting an English sentence still ends with a Chinese mark after the quote: 她的原话是“Are you serious?”。 (M) [T14; CYT154 §5.1.2.2]
- Ordinary English words inside Chinese are lowercase; full name and abbreviation in brackets take an English comma: 脱氧核糖核酸（deoxyribonucleic acid, DNA）; English words take no quotes, English sentences take “”. (M/S) [T11–T13]
- CJK compatibility ideographs (U+F900–U+FAFF) become unified ideographs by NFC, except the 12 unified characters in that block. (M) [T16]

## numbers
- Arabic numerals for counting, measurement, percentages, money, values with units and identifiers. (M) [N1, N2; GB15835 §4.1]
- Chinese numerals for fixed expressions (一律, 星期五), approximations (三四个月, 几千) and non-Gregorian dates; never 3、4个月 or 几1000. (M) [N3]
- Arabic for concise text, Chinese for formal text where either works; one form per category (not 二〇〇八年8月8日). (S/M) [N4, N5]
- 零 in counting (三千零五十二); 〇 in numbering and years (二〇一二年). (M) [N14]
- Digits mix with Chinese numerals only for 万/亿 (10亿零817万5288人); never 4千 or 1百零8. (M) [N16]
- Dates year-month-day; hyphen form only for complete dates; never shorten a year (90年, 七八年). (M) [N10, N15]
- Times 15:40 (half-width colon) or 15时40分; decimals 0.46. (M) [N8, N11]
- Digits half-width; a number never splits from its unit across lines. (M) [N13]
- Grouping optional for five or more digits: thousands commas or a thin space, never both; [academic] thin spaces from four digits (1 000, 0.000 1). Never group years, pages or codes. (M) [N7, A15]
- Ranges with ～ or —; keep 万/亿, % and ×10ⁿ on both ends (15%～30%); a shared unit once (1.5～3.6 mA) or on both ends per setting. (M) [N9]
- Value–unit space per `unit-space` (16 GB, 20 °C); none before %, °, ′, ″; [academic] space. (M) [N19, A12]
- Month-day events: “3·15”, “5·27”事件; Chinese-numeral forms take 间隔号 only for months 一, 十一, 十二 (“一·二八”; 五四运动). (M) [N12]
- Keep established terms: 3G, MP3, G8峰会, 维生素B12. (guard) [N20]
- 增加了两倍 = ×3, 增加到两倍 = ×2; never 降低/减少 N 倍. (S) [N18]
- Legal and financial amounts in capital numerals (叁仟伍佰零肆圆). (M) [N17]

## words
- 的 + noun, 地 + verb, 得 after verbs and adjectives. (S, grammar check) [W2]
- Wrong-character list: 再接再厉, 迫不及待, 按部就班, 走投无路, 甘拜下风, 墨守成规, 谈笑风生, 金榜题名, 震撼, 寒暄, 针砭, 松弛, 脉搏, 竣工, 气概, 辐射, 编纂, 赝品, 一如既往, 美轮美奂, 不胫而走, 明信片, 部署, 候车, 一筹莫展, 黄粱. (M) [W3]
- Variant words: suggest the GF 1001 form (笔画, 计划, 答复…); 蹚 and 噘 are standard now; don't flag 标识. (M) [W1]
- Check in context: 截至/截止, 必须/必需, 权利/权力, 制定/制订, 启用/起用, 反映/反应, 以至/以致, 期间/其间, 界限/界线, 做/作, 账/帐 (账 for money), 品味/品位. (S) [W4]
- Idiom meanings: 差强人意 (roughly satisfactory), 首当其冲 (first to bear the brunt), 罄竹难书 (crimes), 七月流火 (weather cooling), 万人空巷, 美轮美奂 (buildings). (S) [W5]
- Respectful terms (残疾人, 盲人, 聋人, 智力障碍者); no regional or group discrimination. (S) [W6]
- No Traditional or variant characters in Simplified text unless quoted, a name, or deliberate. (M) [W7]
- Proper-noun casing (HTML5, Next.js); no home-made abbreviations. (M) [T5]
- Gloss necessary foreign words on first use; don't sprinkle English into Chinese prose. (S) [T6; 语言文字法2025 Art. 12]
- Pinyin: word by word, capitals for names and sentence starts, 复姓 solid, place names Běijīng Shì. (M/S) [T17; GB16159; GB28039]

## dialogue
- 他说：“……。” / “……。”他说。 / “……，”他说，“……。” (M) [P17; GB15834 B.1.5]
- Outer “”, inner ‘’; multi-paragraph quotes open every paragraph and close only the last. (M) [P18]
- Final mark inside when the quote is complete and independent or ends in ？！; otherwise none inside and the pause mark outside. (S) [P19]
- —— for interruption, a drawn-out sound or a topic change; …… for trailing off; normally no point mark right before them. (M/S) [P21]
- Vertical text: 『』 outer, 「」 inner; store normal brackets. (M) [GB15834 §5.2.3; clreq]
- [quotes=corner] 「」 then 『』 only when the profile asks. (setting)

## register
- 你 or 您, one per document (您 for external, formal readers). (S) [TW19 setting]
- [tech] clauses ≤ 20 characters ideal, never > 40 without punctuation; comma chains ≤ 100; paragraphs one topic, topic sentence first, ≤ 7 lines; active, affirmative; no double negatives; unambiguous 其/该/此. (S/M) [W8, W9]
- Headings: no skipped level, no lone sub-heading, child doesn't repeat parent. (M) [W10]

## letters
- Salutation on its own line with ：; 此致 indented two characters, 敬礼 flush left on the next line; signature, then date. (S) [GB15834 §4.7.3.4; convention]

## official
- Pick one of the 15 types by purpose: 请示 asks a superior; 报告 reports; 函 goes between bodies without a reporting line; 纪要 records main proceedings and decisions. (S) [G1; 条例2012 Art. 8]
- Title = 发文机关 + 关于……的 + 文种; no mixed types (请示报告); no punctuation in titles except 《》. (M) [G2]
- 请示: one matter; one main superior; never copied to subordinates; when forwarding a subordinate's request, add your own view; close 妥否，请批示。 (S) [G3; Art. 15]
- 报告: no 请示 items (flag 请批准, 请批示, 请审批); close 特此报告。 (M) [G4]
- 函: 贵单位/贵局; 特此函告。/请予函复。 (S) [G5]
- 纪要: 会议认为/指出/决定/要求; 出席：/列席：/请假： lines with unit and name. (S) [G6]
- 发文字号: code + 〔year〕 + number + 号, no 第, no leading zero (国办发〔2012〕9号). (M) [G7]
- 成文日期: Arabic numerals, full year, no zero padding (2026年10月9日). (M) [G8]
- Levels 一、 → （一） → 1. → （1）; body paragraphs indented two characters. (M) [G9, G14]
- 主送 line ends with ：; 抄送：…。; 附件：1.××× with no final punctuation; 附注 in （）. (M) [G10]
- 内容简洁，主题突出，观点鲜明，结构严谨，表述准确，文字精练. (S) [G12; 条例 Art. 19]
- No CJK–Latin spaces by convention; units, punctuation and numbers per GB 3100/GB15834/GB15835. (M) [G13]
- No skip-level documents (copy the bypassed body if unavoidable); important downward documents copied to the issuer's superior. (S) [G15]

## academic
- Title ≤ 25 字, standard terms, no hype; abstract self-contained, no figure/table/reference numbers, about 400/300/150 字 by type; 3–8 specific keywords. (M) [A1–A3; GB7713.2]
- Author pinyin Li Jiangning (surname first, given name solid); 复姓 solid, double surnames hyphenated. (M) [A4; GB28039]
- Sections 2.1 / 3.2.1, ≤ 4 levels, no trailing dot; figures and tables numbered 图1, 表2, 式(1). (M) [A5, A6]
- References per GB/T 7714-2025 (2015 when a journal asks): one system per paper; symbols (. : , ; // () [] / -); up to three authors listed, then 等/et al.; type codes M C G N J D R S P DB CP EB A CM DS PP Z, carriers MT DK CD OL MM. (M) [A7–A11; GB7714]
- SI units and quantity names; number–unit space; Ki/Mi binary prefixes; no stacked prefixes. (M) [A12, A16]
- Never invent references, data or quotations; mark unverifiable ones for the author. Misconduct: 剽窃, 伪造, 篡改, 不当署名, 一稿多投, 重复发表. (S) [A13; CYT174]
- Conclusions distil results; acknowledgements follow the conclusion, unnumbered. (S) [A14]

## social
- No clickbait titles, scandal hype, careless comment on disasters, innuendo, gore, discrimination or content that leads minors into unsafe behaviour. (S) [NM1; 生态治理规定 Art. 7]
- Absolute terms (国家级, 最高级, 最佳 and equivalents: 最好, 第一, 顶级, 首选, 史上最) are review flags, not errors: exempt service attitude or aims, same-brand comparison, usage tips, standard grades, product names and trademarks, official awards, and dated objective sales or share data; never lenient for medical, health, investment or education claims. (M flag) [NM2; 广告法 Art. 9(三); SAMR绝对化指南 §§2, 4–7, 9–11]
- Health: no disguised health ads; no disease-treatment claims outside medical ads; health foods: 本品不能代替药物. (M flag) [NM3; 广告法 Arts. 16–18; 互联网广告办法 Art. 8]
- Knowledge, experience or review posts with purchase links are labelled 广告; every ad must be identifiable. (M flag) [NM4; 互联网广告办法 Art. 9]
- AI-generated posts: remind the user to use the platform's AI-content declaration. (S) [NM5; 标识办法 Art. 10]
- Data, survey results and quotations in ads give their source and scope (flag 数据显示 without a source). (M flag) [NM11; 广告法 Arts. 11–12]
- Mainland ads and signage use 规范汉字; Traditional characters only under the law's exceptions. (M flag) [NM10; 语言文字法2025 Arts. 14, 15, 19]
- Platform limits: `craft#platforms`. [NM6, NM7]

## ai-tells
- Strong (edit on one sighting): 不是 X 而是 Y / 并非…而是… / 不在于…而在于… / 不只是…更是… used as a shell (keep when it corrects a real belief); 让我们深入看看 / 下面我们来看 openers; 标志着…新时代 inflation; 彰显了… tails; 客服腔 (希望对您有帮助！); 总而言之…让我们拭目以待 closers; empty 随着…的发展 / 在…的时代背景下 openers.
- Weak (only in clusters): 赋能, 至关重要, 深入探讨, 无缝, 闭环 used vaguely; mechanical 首先…其次…最后; forced triads; 四字词排比 that says nothing; dashes as all-purpose links; stacked hedges (可能也许); chains of 的; 进行 + verb (fine in formal text); stacked 被; 正确的废话.
- Hard to read (edit when it slows the reader): 主语前一长串定语（把从句拆开或后置）; 三个以上名词连用作定语; 让事物做人的动作（数据告诉我们、这首歌邀请你）, unless the author means the figure; 主语和谓语之间插入很长的成分; 生造的搭配. Each is rewritten to the plain sentence it stands for. [Clark, Martin & Mahowald 2026, adapted]
- Sources: [Humanizer-zh #1, #4, #6, #8, #9, #12, #13, #15, #22, #26–#31 (MIT); 科普中国 2025 (summarised); ra-人话 (ideas only)]
