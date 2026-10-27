//! More completion contexts, above all Chinese and English everyday writing,
//! poetry, empty paragraphs, list items, table cells, code, and completions
//! under a style profile. The before-text is plain text as the editor sends
//! it; as-you-type requests fire only at the end of the last block.

use super::checks::Lang;
use super::completion_matrix::CompletionCase as C;

const ZH_LONG_SECTION: &str = "我们在三个街区做了为期两个月的访谈，共访谈了 46 位居民。大多数受访者并不反对改造，他们真正担心的是改造期间的临时安置和改造后的租金上涨。\n\n在青石巷，年纪大的居民更在意的是熟人关系会不会被打散。很多人在这里住了三十年以上，买菜、看病、接送孙子，都依赖附近的几户邻居。一位老人说，搬走以后最怕的不是房子小，而是没人说话。\n\n年轻租户的顾虑则集中在房租上。他们大多在附近上班，通勤时间短是选择老城区的主要原因。如果改造后房租上涨，他们中的不少人会考虑搬到更远的地方。\n\n商户的意见又不一样。临街的小店希望改造能带来更多客流，但也担心施工期间生意受影响，希望能分段施工，避开节假日。";

const EN_LONG_SECTION: &str = "We interviewed 46 residents across three blocks over two months. Most of them were not against the renovation. What worried them was where they would live while the work was done, and whether rents would rise afterwards.\n\nOn Stone Lane, older residents cared most about losing their neighbours. Many had lived there for more than thirty years and relied on a few nearby households for shopping, doctor's visits and picking up grandchildren. One man said the worst part of moving would not be a smaller flat but having no one to talk to.\n\nYounger tenants were mostly worried about rent. Most of them work nearby, and a short commute was the main reason they chose the old town. If rents go up after the renovation, many said they would move further out.\n\nShopkeepers saw it differently. Those on the main street hoped the work would bring more customers, but they were afraid of losing business during construction and asked for the work to be done in stages, avoiding the holidays.";

pub fn all() -> Vec<C> {
    let mut v = zh();
    v.extend(en());
    v.extend(other_languages());
    v.extend(style_profiles());
    v
}

fn zh() -> Vec<C> {
    let z = Lang::ZhHans;
    vec![
        C::new("zh/email-mid", z, "王经理您好：\n\n关于下周三的评审会，我们这边的技术负责人临时要去深圳出差，没办法按时参加。想和您商量一下，", "paragraph").title("关于评审会改期的说明", &["关于评审会改期的说明"]).rubric("A polite business email asking to reschedule: expect the request continued (e.g. whether the meeting can move to another day) without inventing a specific date."),
        C::new("zh/email-formal-tone", z, "王经理您好：\n\n关于下周三的评审会，我们这边的技术负责人临时要去深圳出差，没办法按时参加。", "paragraph").title("关于评审会改期的说明", &["关于评审会改期的说明"]).tone("formal"),
        C::new("zh/report-list-item", z, "本周进展\n\n完成了订单模块的接口联调，测试通过率 96%\n\n修复了支付回调重复通知的问题\n\n新增了", "list item").title("第 42 周工作周报", &["第 42 周工作周报", "本周进展"]).max_words(20).rubric("Inside a weekly-report bullet: expect the rest of this one item, terse like its siblings, no invented figures."),
        C::new("zh/academic-mid", z, "已有研究表明，城市绿地与居民心理健康之间存在正相关关系。王明和李华（2019）基于北京 12 个社区的问卷调查发现，", "paragraph").title("城市绿地与居民心理健康", &["城市绿地与居民心理健康", "文献综述"]).rubric("Academic Chinese mid-sentence after a citation: the honest continuation reports a finding in general terms; inventing specific numbers or results is a faithfulness flaw."),
        C::new("zh/academic-tone", z, "城市绿地的质量可能比面积更重要。光有大块草坪而缺少树荫和座椅的绿地，", "paragraph").title("城市绿地与居民心理健康", &["城市绿地与居民心理健康", "文献综述"]).tone("academic"),
        C::new("zh/tech-doc", z, "服务启动前需要在 config.yaml 里设置日志上报地址。如果日志上报延迟超过 5 分钟，", "paragraph").title("部署说明：日志收集服务", &["部署说明：日志收集服务", "常见问题"]),
        C::new("zh/tech-mixed", Lang::Mixed, "我们用 Rust 重写了 parser 之后，冷启动从 2.1 秒降到了 0.6 秒，但内存占用", "paragraph").title("性能优化复盘", &["性能优化复盘"]),
        C::new("zh/numbered-step", z, "部署步骤\n\n安装依赖\n\n修改 config.yaml 里的 endpoint\n\n启动服务并检查", "list item").title("部署说明", &["部署说明", "部署步骤"]).max_words(15).rubric("Inside a numbered deployment step: expect the end of this step only (what to check), no new step."),
        C::new("zh/meeting-list-item", z, "结论\n\n新版首页下周二开始灰度，比例 10%\n\n会员价格维持不变，年底再评估\n\n安卓端的", "list item").title("产品周会纪要", &["产品周会纪要", "结论"]).max_words(20),
        C::new("zh/essay-mid", z, "外婆家的厨房不大，朝北，一年四季都有点暗。灶台是外公自己砌的，", "paragraph").title("外婆的厨房", &["外婆的厨房"]),
        C::new("zh/novel-narration", z, "雨从傍晚开始下，一直没有停。林晚站在书店门口，看着街对面的路灯一盏一盏亮起来。她", "paragraph").title("第三章 雨夜", &["第三章 雨夜"]),
        C::new("zh/dialogue-open-quote", z, "老周从里屋探出头来，问：“你还没走？”\n\n林晚说：“", "paragraph").title("第三章 雨夜", &["第三章 雨夜"]).rubric("The cursor is inside an open Chinese quotation mark: expect 林晚's spoken words (closing the quote with ” is good), in character, no new paragraph."),
        C::new("zh/after-heading", z, "林晚在这座城市的第二年，换了三份工作。最后一份是在旧书店，工资不高，但老板从不催她。\n\n第三章 雨夜\n\n", "paragraph").title("林晚", &["林晚", "第三章 雨夜"]).rubric("An empty paragraph right after the heading 第三章 雨夜: expect the chapter's first sentence, setting the rainy-night scene, starting directly with text (no leading whitespace)."),
        C::new("zh/poem-lines", z, "窗外的雨下了一夜\n\n我数着瓦檐上的水滴\n\n一滴，两滴", "paragraph").title("雨夜", &["雨夜"]).max_words(20).rubric("A poem written one line per paragraph: expect the rest of this line only, matching the short lines and rhythm."),
        C::new("zh/poem-hardbreak", z, "春天来的时候\n我还在等一封信\n邮差绕过了", "paragraph").title("等信", &["等信"]).max_words(15).rubric("A poem whose lines are hard breaks inside one paragraph: expect the rest of the current line only, no line break."),
        C::new("zh/empty-after-long-section", z, &format!("{ZH_LONG_SECTION}\n\n"), "paragraph").title("老城区更新的几点思考", &["老城区更新的几点思考", "调研发现"]).rubric("An empty paragraph after a long section of findings: expect the first sentence of a new paragraph that moves on (e.g. a summary or the next group), no repetition, no invented figures."),
        C::new("zh/table-cell", z, "指标\n\n本周\n\n上周\n\n日活用户\n\n12,400\n\n11,800\n\n订单量\n\n3,150\n\n2,970\n\n崩溃", "table cell").title("第 42 周工作周报", &["第 42 周工作周报", "数据"]).max_words(6).rubric("Inside a table cell (the 指标 column): expect the rest of the metric name (e.g. 率), never a figure or sentence."),
        C::new("zh/social", z, "周末带爸妈去了一趟千岛湖，本来以为十月底人会少一点，结果", "paragraph").title("朋友圈文案", &[]),
        C::new("zh/social-casual-tone", z, "今天终于把拖了半年的牙给拔了，", "paragraph").title("碎碎念", &[]).tone("casual"),
        C::new("zh/product", z, "这款护手霜用的是云南高山山茶花籽油，质地很轻，", "paragraph").title("山茶花护手霜", &["山茶花护手霜"]),
        C::new("zh/candidates-essay", z, "小时候每年暑假我都住在外婆家。她做饭的时候不让我进厨房，说油烟大，我就搬个小板凳坐在门口，看她切菜、烧火、揭锅盖。", "paragraph").title("外婆的厨房", &["外婆的厨房"]).candidates(3).rubric("Manual trigger: three alternatives, each 2-4 sentences in the essay's restrained voice, going in clearly different directions, none inventing dramatic events."),
    ]
}

fn en() -> Vec<C> {
    let e = Lang::En;
    vec![
        C::new("en/email-mid", e, "Hi Daniel,\n\nThanks for your patience on this. Unfortunately our supplier told us last week that their shipment is delayed, so we won't be able to", "paragraph").title("Re: Delivery schedule", &["Re: Delivery schedule"]).space(true),
        C::new("en/email-after-sentence", e, "Hi Daniel,\n\nWe can ship 700 units on 30 September and the remaining 500 by 14 October.", "paragraph").title("Re: Delivery schedule", &["Re: Delivery schedule"]).space(true).rubric("After a complete sentence in a client email: expect the next sentence (e.g. covering the extra freight, or asking if that works) without inventing amounts."),
        C::new("en/email-formal-tone", e, "Hi Daniel,\n\nSorry, but the shipment is going to be late again because our supplier", "paragraph").title("Re: Delivery schedule", &[]).space(true).tone("formal"),
        C::new("en/report-summary", e, "The support team closed 2,300 tickets in Q3, up from 1,980 in Q2. The main driver", "paragraph").title("Q3 support review", &["Q3 support review", "Summary"]).space(true),
        C::new("en/academic", e, "Bloom et al. (2015) found that call-centre employees who worked from home were 13% more productive. However, later studies", "paragraph").title("Literature review", &["Literature review", "Remote work and productivity"]).space(true).rubric("Academic prose after a citation: expect a general, hedged continuation (later studies found mixed results); inventing a citation, author or figure is a faithfulness flaw."),
        C::new("en/academic-tone", e, "The survey covered 412 employees at three firms, so the results", "paragraph").title("Method", &["Method"]).space(true).tone("academic"),
        C::new("en/tech-doc", e, "Uploads that fail with a network error are retried automatically. To change how many times, set the", "paragraph").title("Uploading files with the Textus Sync API", &["Uploading files with the Textus Sync API", "Retries"]).space(true),
        C::new("en/code-js", e, "async function uploadAll(paths) {\n  for (const path of paths) {\n    ", "code block").title("Uploading files", &["Uploading files", "Quick start"]).code().rubric("Inside a fenced JavaScript block at the start of the loop body: expect code (e.g. await client.upload(path, ...)), correct indentation, no prose."),
        C::new("en/ordered-step", e, "Quick start\n\nCreate an API token in Settings > Developer.\n\nInstall the client with npm install @textus/sync.\n\nCall", "list item").title("Uploading files with the Textus Sync API", &["Uploading files with the Textus Sync API", "Quick start"]).space(true).max_words(16).rubric("Inside the third numbered step: expect the rest of this step (e.g. upload() with the file path), no new step."),
        C::new("en/meeting-list-item", e, "Action items\n\nJonas to write the migration notes by Friday\n\nPriya to update the pricing page copy\n\nWen to", "list item").title("Product sync", &["Product sync", "Action items"]).space(true).max_words(12),
        C::new("en/essay-mid", e, "When I was eleven, my grandfather took me to the bookshop on Mill Street every Saturday morning. It was a narrow place with a creaky floor, and", "paragraph").title("The last bookshop on Mill Street", &["The last bookshop on Mill Street"]).space(true),
        C::new("en/novel-narration", e, "The rain had not stopped since morning. Elena stood under the station awning with her collar turned up,", "paragraph").title("Chapter 7", &["Chapter 7"]).space(true),
        C::new("en/dialogue-open-quote", e, "\"You're late,\" she said.\n\n\"The bus broke down,\" Tom said. \"I", "paragraph").title("Chapter 7", &["Chapter 7"]).space(true).rubric("Inside an open quotation (Tom speaking): expect the rest of his line, closing the quote is good, in character."),
        C::new("en/after-heading", e, "The pilot ran for six weeks in two branches, and both teams kept a shared log of every problem they hit.\n\nWhat we learned\n\n", "paragraph").title("Branch pilot review", &["Branch pilot review", "What we learned"]).rubric("An empty paragraph right after the heading 'What we learned': expect the section's opening sentence, no leading whitespace, no invented findings."),
        C::new("en/poem-hardbreak", e, "The kettle ticks as it cools\nthe window holds the last of the light\nand somewhere below", "paragraph").title("Evening", &["Evening"]).space(true).max_words(12).rubric("A poem whose lines are hard breaks: expect the rest of the current line only, no line break, lower-case like the others."),
        C::new("en/poem-lines", e, "Morning\n\nthe frost on the gate\n\nmy breath going", "paragraph").title("Frost", &["Frost"]).space(true).max_words(10).rubric("A poem written one line per paragraph: expect the rest of this short line only."),
        C::new("en/empty-after-long-section", e, &format!("{EN_LONG_SECTION}\n\n"), "paragraph").title("Renovating the old town", &["Renovating the old town", "What we heard"]).rubric("An empty paragraph after a long findings section: expect the first sentence of a new paragraph that moves the text on, no leading whitespace, no repetition, no invented figures."),
        C::new("en/table-cell", e, "Feature\n\nOwner\n\nStatus\n\nOffline mode\n\nJonas\n\nShipped in 1.4\n\nSSO\n\nWen\n\nBlocked on", "table cell").title("Roadmap", &["Roadmap"]).space(true).max_words(6),
        C::new("en/social", e, "After eighteen months of work, Textus 1.0 is finally out today. It's a Markdown editor that", "paragraph").title("Launch post draft", &[]).space(true),
        C::new("en/social-casual-tone", e, "Finally fixed the leaky tap after three YouTube videos and", "paragraph").title("weekend log", &[]).space(true).tone("casual"),
        C::new("en/product", e, "The Hearth thermostat learns your schedule in about a week and", "paragraph").title("Hearth smart thermostat", &["Hearth smart thermostat"]).space(true),
        C::new("en/midword-cost", e, "What we can do is ship 700 units now and the rest by 14 October. We will cover the extra freight co", "paragraph").title("Re: Delivery schedule", &[]).completes("cost"),
        C::new("en/candidates-novel", e, "He held up his phone. The screen was black. \"Battery,\" he said.", "paragraph").title("Chapter 7", &["Chapter 7"]).space(true).candidates(3).rubric("Manual trigger in fiction: three alternatives (2-4 sentences each) continuing the scene in clearly different directions, consistent with Elena's irritation and the dead phone."),
    ]
}

fn other_languages() -> Vec<C> {
    vec![
        C::new("zh-Hant/list-item", Lang::ZhHant, "出發前還要準備：\n\n護照和簽證影本\n\n行動電源和轉接頭\n\n常用", "list item").title("旅行清單", &["旅行清單"]).max_words(10),
        C::new("zh-Hant/after-heading", Lang::ZhHant, "讀書會在一月啟動，至今已經舉辦了二十四次活動。\n\n明年的計畫\n\n", "paragraph").title("週末讀書會", &["週末讀書會", "明年的計畫"]),
        C::new("ja/list-item", Lang::Ja, "持ち物リスト\n\nパスポートとビザのコピー\n\nモバイルバッテリーと変換プラグ\n\n常備", "list item").title("旅行の準備", &["旅行の準備"]).max_words(10).rubric("Inside a Japanese packing-list item: expect the rest of this item only (e.g. 薬), no new item."),
        C::new("ja/dialogue", Lang::Ja, "「もう帰るの？」と店主が聞いた。\n\n「雨が止むまで、", "paragraph").title("雨の夜", &["雨の夜"]),
        C::new("ko/list-item", Lang::Ko, "준비물\n\n여권과 비자 사본\n\n보조 배터리와 어댑터\n\n상비", "list item").title("여행 준비", &["여행 준비"]).max_words(6).rubric("Inside a Korean list item cut mid-word (상비 -> 상비약): expect the word finished with no space before it."),
        C::new("ko/after-sentence", Lang::Ko, "새 도서관은 역에서 걸어서 5분 거리에 있다.", "paragraph").title("역 앞 도서관", &["역 앞 도서관"]).space(true),
        C::new("es/list-item", Lang::Es, "Antes del viaje tenemos que:\n\nrenovar el pasaporte\n\ncambiar dinero\n\nreservar el", "list item").title("Viaje a Lisboa", &["Viaje a Lisboa"]).space(true).max_words(8),
        C::new("es/heading", Lang::Es, "Lecciones de", "heading").title("Un año de la biblioteca", &[]).space(true),
        C::new("fr/list-item", Lang::Fr, "Avant le départ :\n\nrenouveler le passeport\n\nchanger de l'argent\n\nréserver l'", "list item").title("Voyage à Lisbonne", &["Voyage à Lisbonne"]).max_words(8),
        C::new("fr/dialogue", Lang::Fr, "« Tu pars déjà ? » demanda-t-elle.\n\n« Seulement si", "paragraph").title("Chapitre 3", &["Chapitre 3"]).space(true),
        C::new("de/list-item", Lang::De, "Vor der Reise:\n\nReisepass verlängern\n\nGeld wechseln\n\nHotel", "list item").title("Reise nach Lissabon", &["Reise nach Lissabon"]).space(true).max_words(8),
        C::new("de/after-heading", Lang::De, "Der Leseclub hat sich seit Januar jeden Samstag getroffen.\n\nWas wir gelernt haben\n\n", "paragraph").title("Ein Jahr Leseclub", &["Ein Jahr Leseclub", "Was wir gelernt haben"]),
        C::new("ru/list-item", Lang::Ru, "Перед поездкой:\n\nпродлить паспорт\n\nобменять деньги\n\nзабронировать", "list item").title("Поездка в Лиссабон", &["Поездка в Лиссабон"]).space(true).max_words(8),
        C::new("ru/heading", Lang::Ru, "Уроки", "heading").title("Год клуба чтения", &[]).space(true),
        C::new("pt/list-item", Lang::Pt, "Antes da viagem:\n\nrenovar o passaporte\n\ntrocar dinheiro\n\nreservar o", "list item").title("Viagem a Lisboa", &["Viagem a Lisboa"]).space(true).max_words(8),
        C::new("pt/after-sentence", Lang::Pt, "A biblioteca abriu uma segunda sala de leitura em março.", "paragraph").title("Um ano da biblioteca", &["Um ano da biblioteca"]).space(true),
    ]
}

const ZH_PROFILE: &str = "# Style profile\n\n## Sentences and rhythm\n- 每句不超过 20 个字。\n\n## Word choice\n- 不用“非常”“十分”“极其”“特别”。\n\n## Punctuation and formatting\n- 引语用「」，不用“”。\n- 不用感叹号，不用破折号。";
const EN_PROFILE: &str = "# Style profile\n\n## Word choice\n- Never use: very, really, leverage, utilize, incredibly.\n\n## Punctuation and formatting\n- No semicolons and no exclamation marks.";
const EN_PROFILE_ZH_TEXT: &str = "# Style profile\n\n## Sentences and rhythm\n- Short sentences.\n\n## Punctuation and formatting\n- No exclamation marks.\n- No em dashes.";

fn style_profiles() -> Vec<C> {
    vec![
        C::new("style/zh/rules", Lang::ZhHans, "搬家那天下着小雨。我们一早就把箱子搬上了车，", "paragraph").title("关于搬家", &["关于搬家"]).profile(ZH_PROFILE, &["！", "——", "非常", "十分", "极其", "特别", "“"]).rubric("A style profile is active (sentences ≤ 20 characters, no 非常/十分/极其/特别, 「」 quotes, no ！/——): expect a continuation that follows it."),
        C::new("style/en/rules", Lang::En, "Moving house sounds simple until you start packing, and", "paragraph").title("Notes on moving house", &["Notes on moving house"]).space(true).profile(EN_PROFILE, &[" very ", " really ", "leverage", "utilize", "incredibly", ";", "!"]).rubric("A style profile bans very/really/leverage/utilize/incredibly, semicolons and exclamation marks: expect a continuation that follows it."),
        C::new("style/cross/en-profile-zh-text", Lang::ZhHans, "上个月我从城东搬到城西，前前后后折腾了两个星期，", "paragraph").title("关于搬家", &["关于搬家"]).profile(EN_PROFILE_ZH_TEXT, &["！", "——", "!"]).rubric("An English style profile (short sentences, no exclamation marks or em dashes) on Chinese text: expect a Chinese continuation (not English) that follows it."),
    ]
}
