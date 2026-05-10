import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isDisplayableNewsRecord } from "../analyze/topicRelevance.ts";

const HIGH_VALUE_PATTERNS = [
  /openai|sam altman|elon musk|xai|nvidia|microsoft|artificial intelligence|\bai\b/i,
  /brics|new development bank|global south|dedollar|gold|panda bond|msme/i,
  /iran|hormuz|lng|oil|gas|aramco|energy|strait/i,
  /china|taiwan|xi jinping|trump|tariff|trade|rare earth|supply chain/i,
  /russia|ukraine|putin|zelensky|nato/i,
  /gaza|israel|hezbollah|middle east/i,
  /economy|inflation|monetary|bond|finance|market|credit rating/i
];

const NOISE_PATTERNS = [
  /baseball|football|soccer|golf|nba|ufc|sports?|champions league/i,
  /大谷|プロ野球|ゴルフ|サッカー|卓球|芸人|タモリ|カジサック|インフルエンサー/i,
  /restaurant review|food|recipe|wedding|beauty|牛たん|日焼け止め/i
];

const STORY_HARD_NOISE_PATTERNS = [
  /収納術|片付け|口臭|雑談|処世術|直木賞|小川哲|生きづらさ|ライフ/,
  /キャリア・教育|大河ドラマ|豊臣|藤堂高虎|ゲーム|ソシャゲ|マンガ|漫画|アニメ/,
  /牛たん|レシピ|料理|グルメ|美容|結婚|恋愛|占い/
];

const STORY_SINGLE_SOURCE_NOISE_PATTERNS = [
  /試乗|SUV＆EV|日産「?サクラ|マツダ|国内EV市場|マイナーチェンジ|カーライフ/,
  /ドコモ|通信品質|5G設備投資|Windows非セキュリティ|PCI Express|週末に.?一気読み/,
  /SIer幹部|DXは流行遅れ|県内企業|山形|FNNプライムオンライン/
];

const TRUSTED_SINGLE_SOURCE_PATTERNS = [
  /Foundation for Defense of Democracies|FDD|fdd\.org/i,
  /Financial Times|Ft Com|ft\.com/i,
  /Reuters|Associated Press|Bbc Com|Theguardian Com|Aljazeera Com|Jiji Com/i,
  /New Development Bank|BRICS Information Sharing and Exchanging Platform/i
];

const READABLE_LATIN_ALLOWLIST =
  /\b(BRICS|LNG|AI|FDD|FT|US|U\.S\.|EU|UK|NATO|NDB|API|GPT|WHO|AAA|CNY|USD|MSME|IRGC|CCXI|OpenAI|ChatGPT|xAI|Nvidia|Microsoft|TSMC|Google)\b/gi;

const MOJIBAKE_PATTERN = /�|縺|繧|繝|譁|驥|郢|蜈|螟|荳|隕|逕|莉|鬆|髯|蜿|蛯|謌|譛|霎/;

const CATEGORY_RULES = [
  { id: "security", label: "国際政治・安全保障", pattern: /iran|hormuz|gaza|israel|hezbollah|ukraine|russia|putin|taiwan|china|nato|war|missile|defense|安全保障|米中|イラン|台湾|ウクライナ/i },
  { id: "economy", label: "世界経済・エネルギー", pattern: /economy|inflation|tariff|trade|oil|gas|lng|aramco|bond|market|finance|rare earth|supply chain|経済|関税|貿易|原油|ホルムズ|レアアース/i },
  { id: "brics", label: "BRICS・グローバルサウス", pattern: /brics|new development bank|global south|dedollar|panda bond|msme|gold|ndb/i },
  { id: "ai", label: "AI・OpenAI", pattern: /openai|sam altman|elon musk|xai|nvidia|microsoft|artificial intelligence|\bai\b|tsmc|sony semiconductor|フィジカルAI|生成AI/i },
  { id: "public-health", label: "公衆衛生・社会リスク", pattern: /hantavirus|virus|who|cruise ship|infection|health|ハンタウイルス|感染|WHO/i },
  { id: "other", label: "その他", pattern: /./ }
];

const STORY_KEY_RULES = [
  { key: "brics-msme-finance", pattern: /brics.*msme|msme.*brics|small businesses.*financing|中小企業.*金融/i },
  { key: "brics-india-russia-steel", pattern: /india.*russia.*steel|russia.*india.*steel|鉄鋼.*ロシア|ロシア.*鉄鋼/i },
  { key: "brics-iran-meeting", pattern: /iran.*brics.*(minister|summit|meet)|brics.*iran.*(minister|summit|meet)|イラン.*BRICS.*(外相|会合|首脳)/i },
  { key: "ndb-credit-rating", pattern: /new development bank.*credit rating|credit rating.*new development bank|ndb.*rating|新開発銀行.*格付け/i },
  { key: "iran-hormuz-us", pattern: /iran.*(hormuz|tanker|irgc|revolutionary guards|strait)|hormuz.*iran|イラン.*ホルムズ|革命防衛隊.*タンカー/i },
  { key: "us-economy-trump", pattern: /trump.*economy|economy.*trump|トランプ.*経済/i },
  { key: "us-counterterror-muslim-brotherhood", pattern: /counterterrorism.*muslim brotherhood|muslim brotherhood.*counterterrorism|対テロ.*ムスリム同胞団/i },
  { key: "middle-east-europe", pattern: /europe.*middle east|middle east.*europe|欧州.*中東|中東.*欧州/i },
  { key: "ukraine-war-recruitment", pattern: /ukraine.*recruit|ウクライナ.*動員/i },
  { key: "putin-ukraine-war-end", pattern: /putin.*ukraine.*coming to an end|russia.*war.*ukraine.*coming to an end|プーチン.*ウクライナ.*終/i },
  { key: "openai-model-api", pattern: /openai.*(api|model|gpt|chatgpt)|chatgpt|gpt-|openai.*モデル/i },
  { key: "ai-chips-semiconductor", pattern: /(nvidia|tsmc|semiconductor|半導体).*(\bai\b|artificial intelligence|生成AI|人工知能|フィジカルAI)|(\bai\b|artificial intelligence|生成AI|人工知能|フィジカルAI).*(nvidia|tsmc|semiconductor|半導体)/i }
];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#8217;/g, "'")
    .replace(/&#8211;/g, "-")
    .replace(/&#038;/g, "&")
    .replace(/&#8220;|&#8221;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(value, maxLength) {
  const clean = stripHtml(value);
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength - 1)}…`;
}

function parseDate(value) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? time : 0;
}

function formatDate(value, fallback) {
  const time = parseDate(value) || parseDate(fallback);
  if (!time) return "日時不明";
  return new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(time));
}

function recordKey(record) {
  const url = String(record.url || "");
  return [record.source_name || "", url || record.title || "", record.title || ""].join("\u001f").toLowerCase();
}

function uniqueRecords(records) {
  const byKey = new Map();
  for (const record of records) {
    const key = recordKey(record);
    if (!byKey.has(key)) byKey.set(key, record);
  }
  return [...byKey.values()];
}

function isFetchErrorRecord(record) {
  const title = stripHtml(record.title).toLowerCase();
  const notes = stripHtml(record.notes).toLowerCase();
  return title.includes("fetch error") || notes.includes("fetch error");
}

function hasJapanese(value) {
  return /[\u3040-\u30ff\u3400-\u9fff]/.test(String(value || ""));
}

function normalizeEnglishText(value) {
  return stripHtml(value)
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+\|\s+[^|]+$/g, "")
    .trim();
}

function glossaryTranslate(value) {
  const replacements = [
    [/\bNew Development Bank\b/gi, "新開発銀行"],
    [/\bBRICS\b/g, "BRICS"],
    [/\bGlobal South\b/gi, "グローバルサウス"],
    [/\bIran(?:ian)?\b/gi, "イラン"],
    [/\bRevolutionary Guards\b/gi, "革命防衛隊"],
    [/\bUnited States\b|\bU\.S\.\b|\bUS\b/g, "米国"],
    [/\bMiddle East\b/gi, "中東"],
    [/\bStrait of Hormuz\b|\bHormuz\b/gi, "ホルムズ海峡"],
    [/\bRussia(?:n)?\b/gi, "ロシア"],
    [/\bUkraine\b/gi, "ウクライナ"],
    [/\bChina\b/gi, "中国"],
    [/\bIndia\b/gi, "インド"],
    [/\bIsrael\b/gi, "イスラエル"],
    [/\bLebanon\b/gi, "レバノン"],
    [/\bTrump\b/g, "トランプ氏"],
    [/\bMuslim Brotherhood\b/gi, "ムスリム同胞団"],
    [/\bcounterterrorism\b/gi, "対テロ"],
    [/\bterrorism\b/gi, "テロ"],
    [/\beconomy\b/gi, "経済"],
    [/\binflation\b/gi, "インフレ"],
    [/\bcredit rating\b/gi, "信用格付け"],
    [/\bstable outlook\b/gi, "見通しは安定的"],
    [/\btariff(?:s)?\b/gi, "関税"],
    [/\btrade\b/gi, "貿易"],
    [/\boil\b/gi, "原油"],
    [/\bgas\b/gi, "ガス"],
    [/\btanker(?:s)?\b/gi, "タンカー"],
    [/\bwar\b/gi, "戦争"],
    [/\bforeign ministers?\b/gi, "外相"],
    [/\bsummit\b/gi, "首脳会議"],
    [/\bstrategy\b/gi, "戦略"],
    [/\bmarket(?:s)?\b/gi, "市場"],
    [/\bbond(?:s)?\b/gi, "債券"]
  ];

  let result = normalizeEnglishText(value);
  for (const [pattern, replacement] of replacements) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

function fallbackEnglishHeadline(text) {
  const rules = [
    [/satellite images show likely oil slick off iran'?s kharg island/i, "衛星画像がイラン・ハールグ島沖の油膜の可能性を示す"],
    [/tehran, taiwan, trade.*hazards facing trump.*xi summit/i, "習近平氏との会談を前に、トランプ氏がテヘラン、台湾、通商で抱えるリスク"],
    [/steve rosenberg.*victory day parade.*moscow/i, "モスクワの戦勝記念日パレードに例年と違う変化"],
    [/chinese investors jointly produce auto engines at ex-vw plant in kaluga/i, "中国投資家がカルーガの旧VW工場で自動車エンジンを共同生産"],
    [/us missile moves in philippines.*taiwan/i, "米国のフィリピンでのミサイル展開が台湾周辺の緊張を高める"],
    [/europe fails to react to ukrainian drone incidents/i, "欧州がウクライナのドローン事案に十分反応できず"],
    [/shanghai forum 2026.*global governance.*ai.*inclusive development/i, "上海フォーラム2026、グローバル統治、AI、包摂的発展の新構想を議論"],
    [/brics members russia and ethiopia deepen partnership/i, "BRICS加盟国のロシアとエチオピアが産業協力を深化"],
    [/urban mobility represents a visible interface between governance and citizens/i, "都市交通は統治と市民をつなぐ可視的な接点だと指摘"],
    [/^brics opportunity$/i, "BRICSがもたらす機会を論じる記事"],
    [/why are brics countries buying so much gold/i, "BRICS諸国が金購入を増やす背景"],
    [/bengaluru hosts 5th brics sai leaders.*urban mobility/i, "ベンガルールで都市交通を議題にBRICS会計検査機関連合の首脳会合"],
    [/brics nations push for inclusive labour reforms.*social security/i, "BRICS諸国が包摂的な労働改革と社会保障拡大を推進"],
    [/advancing workforce inclusion and digital solutions at brics ewg meet/i, "BRICS雇用作業部会で労働参加とデジタル解決策を議論"],
    [/brics agriculture ministers.*conference.*indore/i, "インドールでBRICS農業相会合を開催へ"],
    [/africa'?s richest man eyes kenya for new refinery/i, "アフリカ有数の富豪が新製油所の候補地としてケニアに注目"],
    [/defence sovereignty.*europe.*low-cost weapons/i, "欧州が防衛主権を掲げ、次世代の低コスト兵器整備を急ぐ"],
    [/google developers.*carbon emissions.*uk datacentres/i, "Google開発者が英国データセンター計画の炭素排出量を大きく見誤ったとの指摘"],
    [/openai trial.*rivalries.*852bn/i, "OpenAIの裁判で、評価額8520億ドルに至る急成長の裏にある対立が露呈"],
    [/european carmakers.*trump tariffs/i, "欧州自動車メーカーがトランプ関税で80億ユーロ規模の打撃"],
    [/germany.*buy tomahawks.*trump/i, "ドイツがトランプ氏との対立後、トマホーク購入を改めて推進"],
    [/australia.*petro-diplomacy.*fuel shortage/i, "オーストラリアの石油外交が燃料不足への懸念を和らげる"]
  ];

  for (const [pattern, translated] of rules) {
    if (pattern.test(text)) return translated;
  }
  if (/brics/i.test(text)) return "BRICS関連の動き";
  if (/iran|hormuz|tanker|middle east/i.test(text)) return "イラン・中東情勢をめぐる動き";
  if (/ukraine|russia|putin|moscow/i.test(text)) return "ロシア・ウクライナ情勢をめぐる動き";
  if (/taiwan|china|xi/i.test(text)) return "中国・台湾情勢をめぐる動き";
  if (/openai|ai|semiconductor|datacentre|technology/i.test(text)) return "AI・技術産業をめぐる動き";
  if (/economy|market|trade|tariff|bond|oil|gas|refinery|fuel/i.test(text)) return "世界経済・通商をめぐる動き";
  return "海外メディアが報じた注目ニュース";
}

function translateEnglishHeadline(value) {
  const text = normalizeEnglishText(value);
  if (!text || hasJapanese(text)) return text;

  const exactRules = [
    [/^India's Major Initiative in BRICS: New MSME Finance Agenda Shared with Russia, China, and Other Members$/i, "インドがBRICSで中小企業金融の新議題を提示し、ロシア・中国など加盟国と共有"],
    [/^Ukraine mass recruits drug addicts and ill patients$/i, "ウクライナが薬物依存者や病人を大規模に動員"],
    [/^India, Russia Hold Steel Sector Round Table; Focus on Deeper Cooperation$/i, "インドとロシアが鉄鋼分野の円卓会議を開き、協力深化を協議"],
    [/^Deputy FM of Iran Gharibabadi likely to attend BRICS Summit in India next week: Sources$/i, "イランのガリババディ外務次官が来週インドのBRICS会合に出席する見通し"],
    [/^Iran's Araghchi could visit India for BRICS foreign ministers' meet in May$/i, "イランのアラグチ外相が5月のBRICS外相会合でインド訪問の可能性"],
    [/^Iran's Revolutionary Guards threaten US sites in Middle East if tankers come under fire$/i, "イラン革命防衛隊、タンカーが攻撃されれば中東の米拠点を標的にすると警告"],
    [/^More than half of US voters disapprove of Trump's handling of economy/i, "米有権者の過半数、トランプ氏の経済運営を不支持"],
    [/^New Development Bank Receives 'AAA' Credit Rating from China Chengxin International \(CCXI\) with Stable Outlook$/i, "新開発銀行、中国誠信国際からAAA格付けを取得、見通しは安定的"],
    [/^Iran war live: IRGC warns US against attacks on ships; Israel bombs Lebanon$/i, "イラン戦争速報: 革命防衛隊が船舶攻撃をめぐり米国に警告、イスラエルはレバノンを爆撃"],
    [/^New U\.S\. Counterterrorism Strategy Spotlights Muslim Brotherhood$/i, "米国の新対テロ戦略、ムスリム同胞団を重点対象に"],
    [/^Europe is writing itself out of the Middle East$/i, "欧州は中東で自ら影響力を失いつつある"],
    [/^Trump calls Iranian regime's attack in Strait of Hormuz a "love tap"$/i, "トランプ氏、イラン体制によるホルムズ海峡攻撃を「軽い一撃」と表現"],
    [/^BRICS Grand Summit in Delhi Amid Middle East Crisis, World's Eyes on India's Diplomacy$/i, "中東危機のなかデリーでBRICS大型会合、インド外交に国際的注目"],
    [/^Putin suggests Russia's war on Ukraine 'coming to an end'$/i, "プーチン氏、ロシアの対ウクライナ戦争が終わりに近づいているとの認識を示す"],
    [/^Vladimir Putin suggests Ukraine war is 'coming to an end'$/i, "プーチン氏、ウクライナ戦争が終わりに近づいているとの認識を示す"],
    [/^Russophrenia strikes again: Baltic states want war with Russia, but resent funding it$/i, "バルト諸国はロシアとの対立を望みながら、その費用負担には反発しているとの論評"],
    [/^OpenAI trial lays bare rivalries behind start-up's \$852bn rise$/i, "OpenAIの裁判で、評価額8520億ドルに至る急成長の裏にある対立が露呈"],
    [/^Defence sovereignty: Europe races to build the low-cost weapons of future$/i, "欧州が防衛主権を掲げ、次世代の低コスト兵器整備を急ぐ"],
    [/^Australia's 'petro-diplomacy' eases fuel shortage fears$/i, "オーストラリアの石油外交が燃料不足への懸念を和らげる"],
    [/^Google developers significantly misstate carbon emissions of proposed UK datacentres$/i, "Google開発者が英国データセンター計画の炭素排出量を大きく見誤ったとの指摘"],
    [/^European carmakers take €8bn hit from Trump tariffs$/i, "欧州自動車メーカーがトランプ関税で80億ユーロ規模の打撃"],
    [/^Germany in fresh push to buy Tomahawks after Trump row$/i, "ドイツがトランプ氏との対立後、トマホーク購入を改めて推進"],
    [/^Africa's richest man eyes Kenya for new refinery$/i, "アフリカ有数の富豪が新製油所の候補地としてケニアに注目"],
    [/^New Development Bank Successfully Issued Dual-Tranche CNY 7 billion Panda Bond with Claw-Back Structure$/i, "新開発銀行が70億元の2本建てパンダ債を発行"],
    [/^New Development Bank Priced USD 2 Billion 3-Year Benchmark Bond$/i, "新開発銀行が20億ドルの3年物ベンチマーク債を発行"],
    [/^Taiwan Authorizes New Defense Spending To Counter Chinese Coercion$/i, "台湾が中国の圧力に対抗するため新たな防衛支出を承認"],
    [/^Israel assassinates commander of Hezbollah Radwan Force$/i, "イスラエルがヒズボラ精鋭部隊ラドワン部隊の司令官を殺害"],
    [/^Flotilla activist gives defiant message after Israel deports him to Greece$/i, "イスラエルにギリシャへ強制送還された支援船団活動家が抗議のメッセージ"],
    [/^A NATO ally's information war: Unmasking Turkey's global media strategy$/i, "NATO加盟国トルコの国際メディア戦略をめぐる情報戦"],
    [/^Starmer insists he won't quit as PM as Labour MP challenges ministers to trigger leadership contest/i, "スターマー英首相が辞任を否定、労働党内では党首選要求も浮上"],
    [/^Hantavirus cruise ship arrives in Tenerife for evacuation$/i, "ハンタウイルス感染懸念のクルーズ船が避難対応のためテネリフェに到着"],
    [/^Two wins, two losses: What India, Pakistan have learned a year after war$/i, "戦争から1年、インドとパキスタンが得た教訓"],
    [/^Protests in Syria's Kurdish region highlight demand for rights$/i, "シリアのクルド地域で権利要求を掲げた抗議が広がる"],
    [/^2026 TRIP Effectiveness Report$/i, "2026年TRIP有効性レポート"]
  ];
  for (const [pattern, translated] of exactRules) {
    if (pattern.test(text)) return translated;
  }

  let translated = glossaryTranslate(text);
  translated = translated
    .replace(/^(.+?) threatens (.+?) if (.+)$/i, "$1、$3場合に$2を威嚇")
    .replace(/^(.+?) warns (.+?) against (.+)$/i, "$1、$3をめぐり$2に警告")
    .replace(/^(.+?) receives (.+?) from (.+)$/i, "$1、$3から$2を取得")
    .replace(/^(.+?) could visit (.+?) for (.+)$/i, "$1、$3のため$2訪問の可能性")
    .replace(/^(.+?) likely to attend (.+)$/i, "$1、$2に出席する見通し")
    .replace(/^(.+?) calls (.+?)$/i, "$1、$2と発言");
  if (translated === text || latinLetterRatio(translated) > 0.25) return fallbackEnglishHeadline(text);
  return translated;
}

function displayTitle(record) {
  return translateEnglishHeadline(record.title || record.source_name || "");
}

function displaySummary(record) {
  const summary = summaryFor(record);
  return translateEnglishHeadline(summary);
}

function latinLetterRatio(value) {
  const text = String(value || "");
  const letters = (text.match(/[A-Za-z]/g) || []).length;
  const meaningful = (text.match(/[A-Za-z\u3040-\u30ff\u3400-\u9fff]/g) || []).length;
  return meaningful ? letters / meaningful : 0;
}

function isReadableJapanese(value) {
  const text = String(value || "");
  return hasJapanese(text) && latinLetterRatio(text) < 0.35;
}

function isGenericFallbackText(value) {
  const text = String(value || "").trim();
  return /^海外メディアが報じた注目ニュース$/.test(text)
    || /をめぐる動き$/.test(text)
    || /^BRICS関連の動き$/.test(text)
    || /^海外メディアが報じた/.test(text);
}

function comparableText(value) {
  return normalizeEnglishText(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[。.!?！？、,\s]/g, "");
}

function formatDayLabel(time) {
  if (!time) return "";
  const date = new Date(time);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function leadRecordTime(story) {
  const lead = story.records[0];
  return parseDate(lead?.published_at) || parseDate(lead?.fetched_at) || 0;
}

function storyWhenPhrase(story) {
  const time = leadRecordTime(story);
  return time ? formatDayLabel(time) : "時点不明";
}

function combinedText(record) {
  return [
    record.title,
    record.source_name,
    ...(record.facts || []),
    record.url
  ].join(" ");
}

function recordAgeDays(record, generatedAt = new Date()) {
  const time = parseDate(record.published_at) || parseDate(record.fetched_at);
  if (!time) return 0;
  return Math.max(0, (generatedAt.getTime() - time) / 86400000);
}

function isFresh(record, generatedAt, maxDays = 21) {
  const time = parseDate(record.published_at) || parseDate(record.fetched_at);
  if (!time) return true;
  return recordAgeDays(record, generatedAt) <= maxDays;
}

function scoreRecord(record) {
  const text = combinedText(record);
  let score = 0;
  for (const pattern of HIGH_VALUE_PATTERNS) {
    if (pattern.test(text)) score += 3;
  }
  for (const pattern of NOISE_PATTERNS) {
    if (pattern.test(text)) score -= 4;
  }
  const age = recordAgeDays(record);
  if (age > 14) score -= 2;
  if (age > 45) score -= 3;
  if (age > 90) score -= 5;
  if (record.retrieval_method === "rss") score += 2;
  if (record.source_name === "Foundation for Defense of Democracies") score += 1;
  if (/BRICS|New Development Bank/i.test(record.source_name || "")) score += 2;
  if (/Financial Times|Ft Com|Bbc Com|Theguardian Com|Aljazeera Com|Jiji Com/i.test(record.source_name || "")) score += 1;
  return score;
}

function categoryFor(record) {
  const text = combinedText(record);
  const bricsRule = CATEGORY_RULES.find((rule) => rule.id === "brics");
  if (bricsRule && /brics|new development bank|global south|ndb/i.test(text)) return bricsRule;
  return CATEGORY_RULES.find((rule) => rule.pattern.test(text)) || CATEGORY_RULES.at(-1);
}

function tagsFor(record) {
  const text = combinedText(record);
  const tags = [];
  if (/openai|sam altman|artificial intelligence|\bai\b|生成AI/i.test(text)) tags.push("AI");
  if (/brics|new development bank|global south|ndb/i.test(text)) tags.push("BRICS");
  if (/iran|イラン/i.test(text)) tags.push("イラン");
  if (/hormuz|oil|gas|lng|energy|aramco|ホルムズ/i.test(text)) tags.push("エネルギー");
  if (/china|taiwan|xi jinping|米中|中国|台湾/i.test(text)) tags.push("米中");
  if (/ukraine|zelensky|ウクライナ/i.test(text)) tags.push("ウクライナ");
  else if (/russia|putin/i.test(text)) tags.push("ロシア");
  if (/tariff|trade|関税|貿易|rare earth|レアアース/i.test(text)) tags.push("通商");
  if (/gaza|israel|hezbollah|middle east/i.test(text)) tags.push("中東");
  if (/hantavirus|virus|who|感染/i.test(text)) tags.push("公衆衛生");
  return tags.slice(0, 4);
}

function storyKey(record) {
  const text = combinedText(record);
  for (const rule of STORY_KEY_RULES) {
    if (rule.pattern.test(text)) return rule.key;
  }

  const signals = [];
  const signalRules = [
    ["brics", /brics|new development bank|ndb|global south|BRICS|新開発銀行/i],
    ["iran", /iran|イラン/i],
    ["hormuz", /hormuz|ホルムズ/i],
    ["ukraine", /ukraine|ウクライナ/i],
    ["russia", /russia|putin|ロシア/i],
    ["china", /china|taiwan|xi jinping|中国|台湾|米中/i],
    ["trump", /trump|トランプ/i],
    ["economy", /economy|inflation|market|bond|finance|経済|金融|市場|インフレ/i],
    ["energy", /oil|gas|lng|energy|原油|ガス|エネルギー/i],
    ["openai", /openai|chatgpt|gpt-|sam altman/i],
    ["ai", /artificial intelligence|\bai\b|生成AI|人工知能/i],
    ["middle-east", /gaza|israel|hezbollah|middle east|ガザ|イスラエル|中東/i]
  ];

  for (const [signal, pattern] of signalRules) {
    if (pattern.test(text)) signals.push(signal);
  }
  const strongSignalGroups = [
    ["iran", "hormuz"],
    ["iran", "middle-east"],
    ["trump", "economy"],
    ["openai", "ai"],
    ["china", "taiwan"]
  ];
  const strongGroup = strongSignalGroups.find((group) => group.every((signal) => signals.includes(signal)));
  if (strongGroup) return `${categoryFor(record).id}:${strongGroup.join("-")}`;

  const words = normalizeEnglishText(record.title || displayTitle(record))
    .toLowerCase()
    .match(/[a-z0-9]{4,}|[\u3040-\u30ff\u3400-\u9fff]{2,}/g);
  return `${categoryFor(record).id}:${(words || []).slice(0, 5).join("-") || recordKey(record)}`;
}

function mediaKey(record) {
  const url = String(record.url || "");
  try {
    const host = new URL(url).hostname
      .replace(/^www\./i, "")
      .replace(/^m\./i, "")
      .toLowerCase();
    if (host) return host;
  } catch {
    // URL is optional in imported records.
  }
  return normalizeEnglishText(record.source_name || "unknown")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function storyMediaKeys(story) {
  return [...new Set(story.records.map((record) => mediaKey(record)).filter(Boolean))];
}

function mediaCount(story) {
  return storyMediaKeys(story).length;
}

function storySearchText(story) {
  return story.records
    .map((record) => [
      record.title,
      displayTitle(record),
      record.source_name,
      record.url,
      ...(record.facts || [])
    ].join(" "))
    .join(" ");
}

function isMultiMediaStory(story) {
  return mediaCount(story) >= 2;
}

function isStoryNoise(story) {
  const text = storySearchText(story);
  if (STORY_HARD_NOISE_PATTERNS.some((pattern) => pattern.test(text))) return true;
  if (mediaCount(story) < 2 && STORY_SINGLE_SOURCE_NOISE_PATTERNS.some((pattern) => pattern.test(text))) return true;
  return mediaCount(story) < 2 && categoryFor(story.records[0]).id === "other" && scoreStory(story) < 8;
}

function isTrustedSingleSourceStory(story) {
  if (isStoryNoise(story)) return false;
  if (categoryFor(story.records[0]).id === "other") return false;
  const text = storySearchText(story);
  if (TRUSTED_SINGLE_SOURCE_PATTERNS.some((pattern) => pattern.test(text)) && scoreStory(story) >= 8) return true;
  return scoreStory(story) >= 13;
}

function isDisplayStory(story) {
  if (isStoryNoise(story)) return false;
  return isMultiMediaStory(story) || isTrustedSingleSourceStory(story);
}

function scoreStory(story) {
  const scores = story.records.map((record) => scoreRecord(record));
  const maxScore = Math.max(...scores, 0);
  return maxScore + Math.min(story.records.length - 1, 4) + Math.min(Math.max(mediaCount(story) - 1, 0), 4) * 3;
}

function storyNewestTime(story) {
  return Math.max(...story.records.map((record) => parseDate(record.published_at) || parseDate(record.fetched_at) || 0), 0);
}

function storyRankScore(story) {
  const multiMediaBoost = isMultiMediaStory(story) ? 45 : 0;
  const mediaBoost = Math.min(mediaCount(story), 5) * 7;
  const articleBoost = Math.min(story.records.length, 6);
  const categoryPenalty = categoryFor(story.records[0]).id === "other" ? 12 : 0;
  return scoreStory(story) + multiMediaBoost + mediaBoost + articleBoost - categoryPenalty;
}

function compareStoryPriority(left, right) {
  return storyRankScore(right) - storyRankScore(left) || storyNewestTime(right) - storyNewestTime(left);
}

function makeStories(records, limit = Infinity) {
  const byKey = new Map();
  for (const record of records) {
    const key = storyKey(record);
    if (!byKey.has(key)) byKey.set(key, { id: key, records: [] });
    byKey.get(key).records.push(record);
  }

  const stories = [...byKey.values()].map((story) => {
    story.records.sort((left, right) => scoreRecord(right) - scoreRecord(left) || sortNewestFirst(left, right));
    return story;
  });

  stories.sort(compareStoryPriority);
  return Number.isFinite(limit) ? stories.slice(0, limit) : stories;
}

function pickDiverseStories(stories, limit) {
  const selected = [];
  const deferred = [];
  const byCategory = new Map();

  for (const story of [...stories].sort(compareStoryPriority)) {
    const category = categoryFor(story.records[0]).id;
    if ((byCategory.get(category) || 0) >= 6) {
      deferred.push(story);
      continue;
    }
    selected.push(story);
    byCategory.set(category, (byCategory.get(category) || 0) + 1);
    if (selected.length >= limit) return selected;
  }

  for (const story of deferred) {
    selected.push(story);
    if (selected.length >= limit) break;
  }
  return selected;
}

function storyTags(story) {
  const tags = [];
  for (const record of story.records) {
    for (const tag of tagsFor(record)) {
      if (!tags.includes(tag)) tags.push(tag);
    }
  }
  return tags.slice(0, 5);
}

function storyTitle(story) {
  const lead = story.records[0];
  return truncate(displayTitle(lead).replace(/[。.!?]+$/u, ""), 120);
}

function bodyFromStoryId(story) {
  const when = storyWhenPhrase(story);
  const bodies = {
    "brics-msme-finance": `${when}、インドはBRICS内で中小企業金融を新たな協力課題として示した。2026年のBRICS議長国として、ロシアや中国を含む加盟国に金融アクセスと事業者支援を協力議題として広げる狙いがある。開発金融や通商協力を通じ、BRICSを政治会合だけでなく実務経済の枠組みにする動きとして見たい。`,
    "iran-hormuz-us": "5月9日（土）、イランメディアは、イラン革命防衛隊が自国のタンカーや商船が攻撃された場合、中東の米国施設や敵艦を標的にすると警告したと報じた。米国や同盟国による船舶攻撃への抑止メッセージで、ホルムズ海峡と湾岸の海上輸送リスクが改めて焦点になっている。原油・LNGの輸送路に関わるため、軍事的発言がエネルギー価格や保険料に波及しやすい局面だ。",
    "brics-iran-meeting": `${when}、イラン高官のBRICS会合参加が報じられた。中東危機のなかで、インド、ロシア、中国を含む外交調整の場としてBRICSが使われている。対米関係が緊張する局面で、イランがBRICSを通じて政治的な後ろ盾や経済的接点を広げようとしている点が重要だ。`,
    "ukraine-war-recruitment": `${when}、ウクライナの兵員確保をめぐる報道が出た。戦争長期化により、動員対象の拡大、兵員の質、国内社会の受忍限度が同時に論点になっている。前線の持久力だけでなく、欧米支援の政治的な持続性にも関わる話だ。`,
    "brics-india-russia-steel": `${when}、インドとロシアは鉄鋼分野の円卓会議を開いた。供給網、技術、研究協力を議題に、産業面での協力深化を図っている。対ロ制裁下でもBRICS圏内で実物産業の結びつきを保つ動きとして、通商と制裁回避の両面から確認したい。`,
    "us-economy-trump": `${when}、FTの調査で米有権者の過半数がトランプ氏の経済運営を不支持と報じられた。イラン情勢、インフレ、生活費への不満が評価を押し下げており、外交危機が国内経済評価に接続している。中間選挙に向けて、関税、エネルギー価格、金融市場の反応が政権支持率を左右し得る。`,
    "ndb-credit-rating": `${when}、新開発銀行は中国の格付け会社からAAA格付けを得た。BRICS系金融機関として、中国市場での資金調達力を高める材料になる。加盟国の開発金融をドル建て市場だけに依存させないというBRICS側の制度づくりともつながる。`,
    "us-counterterror-muslim-brotherhood": `${when}、米国の新たな対テロ戦略でムスリム同胞団が重点対象として扱われた。中東政策と国内安全保障をつなぐ論点で、同盟国との情報共有や制裁指定の範囲に影響する可能性がある。イスラム政治運動をどこまで安全保障対象として扱うかが、地域外交の摩擦点になり得る。`,
    "middle-east-europe": `${when}、欧州の中東関与が弱まっているとの分析が出た。米国、イスラエル、湾岸諸国が主導する局面で、欧州の発言力低下が問題視されている。ガザ、イラン、エネルギー安全保障が重なるなか、欧州が制裁や人道外交以外の実効的な手段を持てるかが問われている。`,
    "putin-ukraine-war-end": `${when}、プーチン大統領は、近年で最も規模を縮小した戦勝記念日パレードでウクライナへの勝利を約束した数時間後、記者団に戦争は終わりに近づいているとの見方を示した。軍事的勝利の演出と和平を示唆する発言が同じ日に出ており、国内向けの強硬姿勢と対外交渉の余地を同時に残す発信になっている。停戦や安全保障条件をめぐる次の具体発言が確認点だ。`,
    "openai-model-api": `${when}、OpenAIや関連するAIモデル・APIの動きが報じられた。製品更新だけでなく、企業導入、競合関係、規制対応が同時に動いており、AI市場の主導権争いとして読む必要がある。モデル性能よりも、提供条件、価格、訴訟・政策リスクが事業環境を左右しやすい。`,
    "ai-chips-semiconductor": `${when}、AI、半導体、次世代防衛技術に関わる産業動向が報じられた。計算資源、製造拠点、データセンター電力がAI競争の制約になっており、企業戦略と国家安全保障が重なっている。供給網の偏りや輸出規制が、投資判断と同盟国間の役割分担に影響する。`
  };
  return bodies[story.id] || "";
}

function fallbackStoryBody(story) {
  const when = storyWhenPhrase(story);
  const category = categoryFor(story.records[0]).id;
  const bodies = {
    security: `${when}時点で、安全保障や外交リスクの変化を示す動きが報じられた。軍事的発言、制裁、交渉姿勢のどれが実務に移るかで、同盟関係や市場への波及が変わる。関係国の次の公式発言と現場での行動を続けて確認したい。`,
    economy: `${when}時点で、市場、通商、エネルギー、企業活動への波及を確認したい動きが報じられた。価格、金利、関税、供給網の数字に反映されるかが次の焦点になる。政策対応が出る場合は、短期の市場反応と中期の投資判断を分けて見る必要がある。`,
    brics: `${when}時点で、BRICS内の制度、外交、開発金融をめぐる動きが出ている。加盟国間の協力が会議声明にとどまるのか、資金調達や通商実務に移るのかが焦点になる。対米欧関係やドル依存の低下をめぐる議論とも接続しやすい。`,
    ai: `${when}時点で、AI関連の企業戦略や技術供給網の動きが報じられた。モデル、半導体、データセンター、規制対応が一体で進んでおり、単独企業のニュースより産業構造の変化として見る必要がある。投資と政策の次の材料を確認したい。`,
    "public-health": `${when}時点で、公衆衛生や社会リスクに関わる動きが報じられた。感染の拡大範囲、行政対応、移動・観光への影響が確認点になる。危機管理上は、公式発表と現地運用のずれを追う必要がある。`
  };
  return bodies[category] || `${when}時点で、今後の政策、外交、経済環境への影響を確認したいニュースが報じられた。単発の出来事ではなく、関係者の次の発言や実務対応に続くかを見たい。`;
}

function storyBody(story) {
  const lead = story.records[0];
  const title = storyTitle(story);
  const configuredBody = bodyFromStoryId(story);
  if (configuredBody) return truncate(configuredBody.replace(/[。.!?]+$/u, "。"), 420);

  const summary = displaySummary(lead).replace(/[。.!?]+$/u, "");
  const usableSummary = summary && !isGenericFallbackText(summary) && comparableText(summary) !== comparableText(title) && isReadableJapanese(summary)
    ? summary
    : "";
  if (usableSummary) return truncate(usableSummary.replace(/[。.!?]+$/u, "。"), 420);

  const supporting = story.records
    .slice(1, 4)
    .map((record) => displayTitle(record).replace(/[。.!?]+$/u, ""))
    .filter((item) => item && comparableText(item) !== comparableText(title))
    .map((item) => `${item}。`);
  return truncate(supporting.join("") || fallbackStoryBody(story), 420);
}

function sentenceCount(value) {
  return (String(value || "").match(/[。.!?！？]/g) || []).length;
}

function readabilityLatinResidue(value) {
  return String(value || "")
    .replace(READABLE_LATIN_ALLOWLIST, "")
    .replace(/[0-9.,:%$€¥+\-_/()"'’“”]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function untranslatedEnglishTerms(value) {
  const terms = readabilityLatinResidue(value).match(/[A-Za-z][A-Za-z-]{2,}/g) || [];
  return [...new Set(terms.map((term) => term.toLowerCase()))].slice(0, 8);
}

function readabilityIssues(story) {
  const title = storyTitle(story);
  const body = storyBody(story);
  const combined = `${title} ${body}`;
  const issues = [];
  const englishTerms = untranslatedEnglishTerms(combined);

  if (!hasJapanese(title)) issues.push("title_has_no_japanese");
  if (!hasJapanese(body)) issues.push("body_has_no_japanese");
  if (MOJIBAKE_PATTERN.test(combined)) issues.push("possible_mojibake");
  if (isGenericFallbackText(title) || isGenericFallbackText(body)) issues.push("generic_fallback_text");
  if (body.length < 80) issues.push("body_too_short");
  if (sentenceCount(body) < 2) issues.push("body_has_too_few_sentences");
  if (!/\d{1,2}月\d{1,2}日|時点|土曜|日曜|月曜|火曜|水曜|木曜|金曜/.test(body)) issues.push("missing_time_anchor");
  if (latinLetterRatio(readabilityLatinResidue(combined)) > 0.18 || englishTerms.length >= 3) {
    issues.push("untranslated_english_terms");
  }

  return {
    id: story.id,
    title,
    media_count: mediaCount(story),
    article_count: story.records.length,
    issues,
    english_terms: englishTerms
  };
}

function isReadableOutputStory(story) {
  const seriousIssues = new Set([
    "title_has_no_japanese",
    "body_has_no_japanese",
    "possible_mojibake",
    "generic_fallback_text",
    "untranslated_english_terms"
  ]);
  return !readabilityIssues(story).issues.some((issue) => seriousIssues.has(issue));
}

function storyLinks(story) {
  const seen = new Set();
  const links = [];
  for (const record of story.records) {
    const key = record.url || `${record.source_name}:${record.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push(record);
  }
  const shown = links.slice(0, 6).map((record) => {
    const source = escapeHtml(record.source_name || "source");
    const date = escapeHtml(formatDate(record.published_at, record.fetched_at));
    const href = escapeHtml(record.url || "#");
    const title = escapeHtml(normalizeEnglishText(record.title || record.source_name || ""));
    return `<a href="${href}" target="_blank" rel="noreferrer" title="${title}">${source}<span>${date}</span></a>`;
  }).join("");
  const rest = links.length > 6 ? `<span class="more">+${links.length - 6}</span>` : "";
  return `<details class="source-links"><summary>元記事 ${links.length}本</summary><div class="source-list">${shown}${rest}</div></details>`;
}

function pickDiverseTop(scored, limit) {
  const selected = [];
  const deferred = [];
  const bySource = new Map();
  const byCategory = new Map();

  for (const item of scored) {
    const source = item.record.source_name || "unknown";
    const category = categoryFor(item.record).id;
    if ((bySource.get(source) || 0) >= 3 || (byCategory.get(category) || 0) >= 6) {
      deferred.push(item);
      continue;
    }
    selected.push(item);
    bySource.set(source, (bySource.get(source) || 0) + 1);
    byCategory.set(category, (byCategory.get(category) || 0) + 1);
    if (selected.length >= limit) return selected;
  }

  for (const item of deferred) {
    selected.push(item);
    if (selected.length >= limit) break;
  }
  return selected;
}

function summaryFor(record) {
  const fact = (record.facts || []).find(Boolean);
  if (fact) return truncate(fact, 320);
  const match = String(record.notes || "").match(/Summary:\s*([^]+?)(?: No source terms| Source terms| robots\.txt|$)/);
  if (match) return truncate(match[1], 320);
  return truncate(record.title || record.source_name || "", 320);
}

function sortNewestFirst(left, right) {
  const leftTime = parseDate(left.published_at) || parseDate(left.fetched_at);
  const rightTime = parseDate(right.published_at) || parseDate(right.fetched_at);
  return rightTime - leftTime;
}

function storyTimeRange(story) {
  const times = story.records
    .map((record) => parseDate(record.published_at) || parseDate(record.fetched_at))
    .filter(Boolean)
    .sort((left, right) => left - right);
  if (!times.length) return { from: 0, to: 0 };
  return { from: times[0], to: times.at(-1) };
}

function isoTime(value) {
  return value ? new Date(value).toISOString() : null;
}

function storyTimeLabel(story) {
  const time = leadRecordTime(story);
  if (!time) return "代表記事時点不明";
  return `代表記事 ${formatDate(new Date(time).toISOString())}`;
}

function storyCard(story, options = {}) {
  const lead = story.records[0];
  const tags = storyTags(story);
  const tagHtml = tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("");
  const title = escapeHtml(storyTitle(story));
  const body = escapeHtml(storyBody(story));
  const category = escapeHtml(categoryFor(lead).label);
  const sourceCount = mediaCount(story);
  const articleCount = story.records.length;
  const timeLabel = escapeHtml(storyTimeLabel(story));
  const className = options.compact ? "card story compact" : "card story";

  return `<article class="${className}">
    <div class="meta"><span>${timeLabel}</span><span>${category}</span><span>${sourceCount}媒体/${articleCount}本</span></div>
    <h3 class="story-title">${title}</h3>
    ${body ? `<p class="story-body">${body}</p>` : ""}
    ${tagHtml ? `<div class="tags">${tagHtml}</div>` : ""}
    ${storyLinks(story)}
  </article>`;
}

function section(id, title, stories) {
  if (!stories.length) return "";
  return `<section id="${escapeHtml(id)}">
    <h2>${escapeHtml(title)}</h2>
    <div class="cards">${stories.map((story) => storyCard(story)).join("\n")}</div>
  </section>`;
}

function nav(categories) {
  return `<nav class="chips">
    <a href="#top">重要</a>
    ${categories.map((category) => `<a href="#${escapeHtml(category.id)}">${escapeHtml(category.label)}</a>`).join("")}
    <a href="#all">全件</a>
  </nav>`;
}

function buildHtml({ generatedAt, topics, articles, manualRecords, browserTasks }) {
  const freshStories = makeStories(articles.filter((record) => isFresh(record, generatedAt, 30)));
  const allStories = makeStories(articles);
  const displayStories = allStories.filter((story) => isDisplayStory(story) && isReadableOutputStory(story));
  const freshDisplayStories = freshStories.filter((story) => isDisplayStory(story) && isReadableOutputStory(story));
  const multiMediaStories = displayStories.filter((story) => isMultiMediaStory(story));
  const topStories = pickDiverseStories(freshDisplayStories, 18);
  const newestStories = makeStories([...articles].sort(sortNewestFirst).slice(0, 80), 40)
    .filter((story) => isDisplayStory(story) && isReadableOutputStory(story))
    .sort((left, right) => (Number(isMultiMediaStory(right)) - Number(isMultiMediaStory(left))) || storyNewestTime(right) - storyNewestTime(left))
    .slice(0, 40);
  const categories = CATEGORY_RULES.filter((rule) => rule.id !== "other");
  const categorySections = categories.map((category) => {
    const categoryStories = displayStories.filter((story) => story.records.some((record) => categoryFor(record).id === category.id));
    const freshCategoryStories = categoryStories.filter((story) => story.records.some((record) => isFresh(record, generatedAt, 45)));
    const items = (freshCategoryStories.length >= 3 ? freshCategoryStories : categoryStories)
      .sort(compareStoryPriority)
      .slice(0, 14);
    return section(category.id, category.label, items);
  }).join("\n");
  const generatedLabel = new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(generatedAt);
  const topicLabels = topics.map((topic) => topic.name || topic.id).join(" / ");

  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="300">
  <title>Research Agent News</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f4f6f8;
      --panel: #ffffff;
      --text: #17202a;
      --muted: #667085;
      --line: #d9dee7;
      --accent: #0f766e;
      --accent-soft: #d8f3ef;
      --warn: #9a3412;
      --shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #111418;
        --panel: #1b2027;
        --text: #eef2f7;
        --muted: #a4adba;
        --line: #333b46;
        --accent: #5eead4;
        --accent-soft: #163c39;
        --warn: #fdba74;
        --shadow: none;
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", "Yu Gothic UI", sans-serif;
      line-height: 1.7;
      text-rendering: optimizeLegibility;
    }
    header {
      padding: 16px max(16px, env(safe-area-inset-left)) 9px;
      border-bottom: 1px solid var(--line);
      background: var(--panel);
      position: sticky;
      top: 0;
      z-index: 10;
      box-shadow: var(--shadow);
    }
    main { width: min(100%, 820px); margin: 0 auto; padding: 14px 12px 48px; }
    h1 { font-size: 20px; line-height: 1.25; margin: 0 0 5px; letter-spacing: 0; }
    h2 {
      font-size: 17px;
      line-height: 1.35;
      margin: 30px 2px 12px;
      letter-spacing: 0;
      padding-top: 4px;
    }
    .sub { color: var(--muted); font-size: 12px; line-height: 1.4; margin: 0; overflow-wrap: anywhere; }
    .chips {
      display: flex;
      gap: 8px;
      overflow-x: auto;
      padding: 9px 0 2px;
      scrollbar-width: none;
    }
    .chips a, .tag {
      flex: 0 0 auto;
      color: var(--accent);
      background: var(--accent-soft);
      border: 1px solid color-mix(in srgb, var(--accent) 28%, transparent);
      text-decoration: none;
      border-radius: 999px;
      padding: 5px 9px;
      font-size: 12px;
      font-weight: 650;
      white-space: nowrap;
    }
    .chips a:focus-visible, .source-links a:focus-visible, summary:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
      margin: 6px 0 4px;
    }
    .stat {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 9px 10px;
      box-shadow: var(--shadow);
    }
    .stat strong { display: block; font-size: 18px; }
    .stat span { color: var(--muted); font-size: 11px; line-height: 1.25; }
    .cards { display: grid; gap: 13px; }
    .card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 15px;
      box-shadow: var(--shadow);
    }
    .card .title {
      display: block;
      color: var(--text);
      font-weight: 720;
      font-size: 16px;
      line-height: 1.35;
      text-decoration: none;
      overflow-wrap: anywhere;
    }
    .card .title:visited { color: color-mix(in srgb, var(--text) 72%, var(--muted)); }
    .story-title {
      margin: 6px 0 0;
      font-size: 17px;
      line-height: 1.42;
      font-weight: 760;
      overflow-wrap: anywhere;
    }
    .story-body {
      margin: 10px 0 0;
      font-size: 14px;
      line-height: 1.78;
      color: var(--text);
      font-weight: 400;
      overflow-wrap: anywhere;
    }
    .original {
      margin-top: 4px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.35;
      overflow-wrap: anywhere;
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 6px 8px;
      margin: 0;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.35;
    }
    .meta span {
      display: inline-flex;
      align-items: center;
      min-height: 20px;
    }
    .tags { display: flex; gap: 6px; flex-wrap: wrap; margin: 10px 0 0; }
    .tag { padding: 3px 7px; }
    p { margin: 6px 0 0; }
    .source-links {
      margin-top: 11px;
      border-top: 1px solid var(--line);
      padding-top: 9px;
    }
    .source-links summary {
      width: fit-content;
      cursor: pointer;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.4;
      list-style-position: outside;
      padding: 2px 0;
    }
    .source-list {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-items: center;
      margin-top: 8px;
    }
    .more {
      color: var(--muted);
      font-size: 12px;
    }
    .source-links a {
      display: inline-flex;
      gap: 5px;
      align-items: center;
      max-width: 100%;
      color: var(--accent);
      background: color-mix(in srgb, var(--accent-soft) 60%, var(--panel));
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 4px 8px;
      text-decoration: none;
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    .source-links a span { color: var(--muted); }
    footer {
      color: var(--muted);
      font-size: 12px;
      padding: 16px 4px;
    }
    .warn { color: var(--warn); }
    @media (min-width: 720px) {
      main { padding-inline: 18px; }
      .card { padding: 18px; }
      .story-title { font-size: 18px; }
      .story-body { font-size: 14.5px; }
    }
    @media (max-width: 420px) {
      header { padding-top: 14px; }
      main { padding-inline: 10px; }
      h1 { font-size: 19px; }
      .stats { gap: 6px; }
      .stat { padding: 8px; }
      .story-title { font-size: 16px; }
      .story-body { font-size: 14px; line-height: 1.72; }
    }
  </style>
</head>
<body>
  <header id="top">
    <h1>Research Agent News</h1>
    <p class="sub">更新: ${escapeHtml(generatedLabel)} / ${escapeHtml(topicLabels)}</p>
    ${nav(categories)}
  </header>
  <main>
    <div class="stats">
      <div class="stat"><strong>${articles.length}</strong><span>RSS記事</span></div>
      <div class="stat"><strong>${multiMediaStories.length}</strong><span>複数媒体</span></div>
      <div class="stat"><strong>${manualRecords.length}</strong><span>確認候補</span></div>
    </div>
    ${section("top", "重要候補", topStories)}
    ${categorySections}
    <section id="all">
      <h2>最新記事</h2>
      <div class="cards">${newestStories.map((story) => storyCard(story, { compact: true })).join("\n")}</div>
    </section>
    <footer>
      自動更新: 5分ごと
    </footer>
  </main>
</body>
</html>`;
}

export async function writeMobileNewsReport(root, { records, topics, generatedAt = new Date(), browserTasks = [] }) {
  const unique = uniqueRecords(records);
  const articles = unique
    .filter((record) => record.retrieval_method === "rss")
    .filter((record) => record.source_name !== "Sample Official RSS Fixture")
    .filter((record) => !isFetchErrorRecord(record))
    .filter((record) => isDisplayableNewsRecord(record));
  const manualRecords = unique.filter((record) => record.retrieval_method === "manual_check");
  const enabledTopics = topics.filter((topic) => topic.enabled);
  const jsonTopStories = pickDiverseStories(
    makeStories(articles.filter((record) => isFresh(record, generatedAt, 30)))
      .filter((story) => isDisplayStory(story) && isReadableOutputStory(story)),
    30
  );
  const html = buildHtml({ generatedAt, topics: enabledTopics, articles, manualRecords, browserTasks });
  const publicDir = join(root, "outputs", "public");
  await mkdir(publicDir, { recursive: true });
  await writeFile(join(publicDir, "index.html"), html, "utf8");
  await writeFile(join(publicDir, "latest.json"), JSON.stringify({
    generated_at: generatedAt.toISOString(),
    topics: enabledTopics.map((topic) => topic.id),
    counts: {
      records: records.length,
      unique_records: unique.length,
      rss_articles: articles.length,
      manual_check_records: manualRecords.length,
      browser_tasks: browserTasks.length
    },
    top: jsonTopStories.map((story) => ({
      id: story.id,
      title: storyTitle(story),
      body: storyBody(story),
      time_label: storyTimeLabel(story),
      representative_published_at: isoTime(leadRecordTime(story)),
      published_from: isoTime(storyTimeRange(story).from),
      published_to: isoTime(storyTimeRange(story).to),
      media_count: mediaCount(story),
      article_count: story.records.length,
      tags: storyTags(story),
      sources: story.records.map((record) => ({
        title: displayTitle(record),
        original_title: stripHtml(record.title),
        source_name: record.source_name,
        url: record.url,
        published_at: record.published_at,
        topic: record.topic
      }))
    }))
  }, null, 2), "utf8");
  return join(publicDir, "index.html");
}
