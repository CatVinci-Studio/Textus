---
name: standards-zh-hant
description: >-
  Writing conventions for Traditional Chinese (Taiwan by default, Hong Kong noted): typography and punctuation, numbers, words, dialogue, register, 公文 函, and AI tells.
license: MIT
metadata:
  textus-version: "1"
  textus-invocation: "hidden"
  textus-sources: "Our own text. Summarised from 教育部《重訂標點符號手冊》 (summarised only, never quoted); quoted or summarised from 行政院 文書處理手冊 and 公文書橫式書寫數字使用原則 (government documents); OpenCC phrase data (Apache-2.0, ideas); W3C clreq (W3C licence); Humanizer-zh (MIT, ideas)."
---

## typography
- 「」 first, 『』 inside; flag “” in the TW profile (some Taiwanese publishers use “”, so the check is a setting). (M) [TW1; MOE-TW 引號; clreq §5.2]
- Every mark is one full-width character, centred; 「」 sit in the corners; 破折號 ── (two U+2500) and 刪節號 …… take two characters. (M) [TW2, TW5; MOE-TW]
- 連接號 — or ～, one character: 1811～1872年. (M) [TW5]
- 間隔號 ． (U+FF0E, centred): 馬克．吐溫, 《禮記．禮運》; MOE also allows ． as a decimal point in Chinese numerals (三．五公里). (M) [TW4]
- 書名號 乙式: 《》 for books, periodicals, newspapers, films, TV programmes, laws and documents; 〈〉 for articles, chapters, single songs, 詞牌 and 曲牌, calligraphy and paintings; book and chapter joined with ．(《禮記．禮運》); headings, covers and mastheads need none. (M) [TW3]
- 頓號 may separate quoted or titled items (「閉月羞花」、「明眸皓齒」; 《水滸傳》、《三國演義》); don't apply the mainland rule that drops 、 between quoted or titled items. (guard) [TW6]
- A lone 句號 should not start a line; most Taiwanese publications don't compress line-end punctuation (renderer). [TW2; clreq §6.3.2]
- CJK–Latin spacing is a setting; Microsoft zh-TW writes 2021 年 3 月 14 日, the 文書處理手冊 writes 民國93年7月8日. (M setting) [T1, T2; MS-zh (cite-only); 文書手冊]
- Normalise CJK compatibility ideographs, common in text pasted from Taiwanese government PDFs. (M) [T16]
- The 15 MOE marks have no 着重號 or 分隔號; 夾注號 is （） or a pair of ──; 專名號 is an underline. (S) [TW10]
- [zh-Hant-HK] Not researched in depth: Taiwanese punctuation rules with Hong Kong character variants (OpenCC HK); flag only inconsistency. [zh.verified.md §5]

## numbers
- [gongwen] Arabic numerals for codes, 文號, dates, ordinals (第4屆), times, event numbers (921大地震), phone numbers, addresses, statistics (6億3,944萬2,789元) and when quoting statutes (第62條); Chinese numerals for descriptive and fixed terms (一律, 第一線, 三讀), proper names and law-drafting text (第四十四條). (M) [TW11; 文書手冊 附錄4]
- [gongwen] Years in 國曆: 中華民國115年10月14日. (M) [TW12]
- [gongwen] 6千元, 1萬500元 accepted; both 約三、四天 and 二三百架次 appear. (guard) [N16 region note; TW6]

## words
- Taiwan vocabulary in place of mainland terms: 軟體, 資訊, 網路, 影片/視訊, 預設, 滑鼠, 列印, 伺服器, 資料庫, 程式, 計程車; 品質 only where 质量 means quality (it also means mass). Suggestions only. (S) [TW18; OpenCC TWPhrases]
- Taiwan variants 裡, 著 vs Hong Kong 裏, 着, 綫, 衞; flag mixtures. (M) [TW17; OpenCC]
- 臺 is the MOE standard form; suggest it only in the 公文 profile. (M) [TW16]
- [gongwen] 法律統一用字: 儘量, 電表/水表, 並, 於, 取消, 澈底, 貫徹, 事蹟, 蹤跡, 公布, 分布, 徵, 部分, 身分, 帳, 占, 蒐集, 菸, 牴觸, 黏貼, 釐訂; noun/verb pairs 雇/僱, 計畫/規劃, 紀錄/記錄, 給與/給予, 聲請/申請. (M) [TW20]
- [gongwen] 法律統一用語: 第九十八條, 第一百條, 第一百十八條; 公布; 制定 (laws) vs 訂定 (orders); 處 for imprisonment and 罰鍰, 科 for 罰金; no 壹貳 in statute numbering; 零 and 萬, not ０ or 万; 設 for agencies, 置 for posts. (M) [TW21]

## dialogue
- 「」 with 『』 inside; a complete quotation keeps its final mark inside 」; a quotation that is part of the sentence has no mark before 」. (S) [TW8; MOE-TW]
- [gongwen] The 公文 punctuation table puts 。 after 」 (總統說：「…才能有擔當」。); don't flag it there. (guard) [TW8; 文書手冊 附錄3]

## register
- 您 for the reader (Microsoft zh-TW). (S) [TW19]

## official
- 函: 主旨 (not itemised; purpose, any deadline and the 期望語), 說明 and 辦法 (itemised, indented, not repeating the 主旨); parts may merge into one or two. The 60-character limit belongs to the 主旨 of a 簽, not a 函. (S) [TW13; 文書手冊 十六(三)]
- 稱謂: 鈞 (a superior in the reporting line), 大 (a superior outside it), 貴 (peers, subordinates, organisations), 臺端 (staff and citizens), 本 (yourself). 挪抬 (a full-width space before 鈞/大/貴 mid-line and before 期望語 verbs to superiors and peers: 請　鑒核) is a convention: offer, never enforce. (M/S) [TW14]
- 期望語: upward 請　鑒核/核示/核備; peers 請　查照/惠復; downward 希查照/照辦. 附送語: 檢陳 upward, 檢送/檢附 otherwise. 引敘語: 依/奉 (superior), 依據 (peers, subordinates), 復 (replies). (S) [TW15]
- Markers: general 一、 甲、 １、; 公文 一、 → (一) → １、 → (１), full-width digits with half-width parentheses; Chinese text and punctuation full-width, Arabic digits and Latin text half-width. (M) [TW7]
- One matter per document; no uncommon abbreviations; when quoting another document, change its direct address (貴/鈞) to indirect (該/本/○○). (S) [TW22]

## ai-tells
- Strong (edit on one sighting): 不是 X 而是 Y / 並非…而是… / 不在於…而在於… / 不只是…更是… used as a shell (keep when it corrects a real belief); 讓我們深入看看 / 下面我們來看 openers; 標誌著…新時代 inflation; 彰顯了… tails; 客服腔 (希望對您有幫助！); 總而言之…讓我們拭目以待 closers; empty 隨著…的發展 / 在…的時代背景下 openers.
- Weak (only in clusters): 賦能, 至關重要, 深入探討, 無縫, 閉環 used vaguely; mechanical 首先…其次…最後; forced triads; 四字詞排比 that says nothing; dashes as all-purpose links; stacked hedges (可能也許); chains of 的; 進行 + verb (fine in formal text); stacked 被; 正確的廢話.
- Hard to read (edit when it slows the reader): 主語前一長串定語（把子句拆開或後置）; 三個以上名詞連用作定語; 讓事物做人的動作（數據告訴我們、這首歌邀請你）, unless the author means the figure; 主語和謂語之間插入很長的成分; 生造的搭配. Each is rewritten to the plain sentence it stands for. [Clark, Martin & Mahowald 2026, adapted]
- Rewrites keep Taiwan quotation marks 「」 and Taiwan vocabulary. [Humanizer-zh (MIT, ideas); 科普中国 2025 (summarised)]
