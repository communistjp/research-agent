const NOISE_PATTERNS = [
  /baseball|football|soccer|golf|nba|ufc|sports?|champions league/i,
  /restaurant review|food|recipe|wedding|beauty|celebrity|entertainment/i,
  /大谷|プロ野球|高校野球|ゴルフ|サッカー|卓球|芸能|芸人|俳優|タレント|アイドル|インフルエンサー/,
  /収納術|片付け|口臭|雑談|処世術|直木賞|小川哲|部屋をきれい|生きづらさ|ライフ/,
  /レシピ|料理|グルメ|美容|日焼け止め|結婚|恋愛|占い/,
  /キャリア・教育|大河ドラマ|豊臣|藤堂高虎|ゲーム|ソシャゲ|マンガ|漫画|アニメ/,
  /試乗|SUV＆EV|日産「?サクラ|マツダ|国内EV市場|マイナーチェンジ|カーライフ/,
  /ドコモ|通信品質|5G設備投資|Windows非セキュリティ|PCI Express|週末に.?一気読み/,
  /SIer幹部|DXは流行遅れ|県内企業|山形|FNNプライムオンライン/
];

const TOPIC_RELEVANCE = [
  {
    id: "openai-news",
    name: /openai|public announcements/i,
    patterns: [
      /openai|sam altman|chatgpt|gpt-|api|model|artificial intelligence|\bai\b|xai|nvidia|microsoft|tsmc|semiconductor|生成AI|人工知能|半導体/i
    ]
  },
  {
    id: "international-politics",
    name: /international politics|security/i,
    patterns: [
      /iran|hormuz|gaza|israel|hezbollah|ukraine|russia|putin|zelensky|china|taiwan|xi jinping|trump|nato|war|missile|defense|terrorism|counterterrorism|muslim brotherhood|foreign policy|diplomacy|sanction|brics|global south/i,
      /イラン|ホルムズ|ガザ|イスラエル|ウクライナ|ロシア|中国|台湾|米中|トランプ|安全保障|外交|防衛|戦争|ミサイル|制裁|BRICS|グローバルサウス/
    ]
  },
  {
    id: "global-economy",
    name: /global economy|policy/i,
    patterns: [
      /economy|inflation|monetary|fiscal|tariff|trade|oil|gas|lng|aramco|bond|market|finance|credit rating|rare earth|supply chain|labor market|gdp|central bank|interest rate|brics|new development bank|development finance|dedollar/i,
      /経済|金融|財政|政策|市場|株|債券|金利|物価|インフレ|関税|貿易|雇用|賃金|税|予算|原油|石油|ガス|LNG|電力|エネルギー|ホルムズ|レアアース|サプライチェーン|半導体|格付け|銀行|投資|円安|円高|ドル|BRICS|新開発銀行/
    ]
  }
];

function textFor(record) {
  return [
    record.title,
    record.source_name,
    record.url,
    ...(record.facts || [])
  ].join(" ");
}

export function isLikelyNoiseRecord(record) {
  const text = textFor(record);
  return NOISE_PATTERNS.some((pattern) => pattern.test(text));
}

export function isRelevantToTopic(record, topic) {
  if (!topic || record.document_type === "error") return true;
  if (isLikelyNoiseRecord(record)) return false;

  const text = textFor(record);
  const rule = TOPIC_RELEVANCE.find((item) => item.id === topic.id || item.name.test(topic.name || ""));
  if (!rule) return true;
  return rule.patterns.some((pattern) => pattern.test(text));
}

export function isDisplayableNewsRecord(record) {
  if (isLikelyNoiseRecord(record)) return false;
  const text = textFor(record).toLowerCase();
  if (text.includes("fetch error")) return false;
  return TOPIC_RELEVANCE.some((rule) => rule.patterns.some((pattern) => pattern.test(text)));
}
