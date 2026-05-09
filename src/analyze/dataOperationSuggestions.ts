const defaultLiberalLens = {
  id: "liberal",
  label: "自由主義的観点",
  description: "個人の自由、政府権限、市場競争、法の支配、多元性を分けて見るための操作提案。",
  dimensions: [
    {
      id: "individual_freedom",
      label: "個人の自由・選択",
      terms: ["自由", "選択", "権利", "移動", "表現", "プライバシー", "自己決定", "民間"]
    },
    {
      id: "state_power",
      label: "政府権限・義務・負担",
      terms: ["義務", "規制", "禁止", "認可", "監督", "罰則", "税", "負担", "徴収", "政府", "自治体"]
    },
    {
      id: "market_competition",
      label: "市場競争・参入機会",
      terms: ["競争", "市場", "民間", "企業", "参入", "価格", "手数料", "投資"]
    },
    {
      id: "rule_of_law",
      label: "法の支配・透明性",
      terms: ["透明", "説明責任", "公開", "監査", "議会", "裁判", "手続", "審査"]
    },
    {
      id: "pluralism",
      label: "多元性・少数者保護",
      terms: ["少数", "差別", "障害", "多様", "包摂", "公平", "移民"]
    }
  ]
};

const numericUnitPattern = /[0-9０-９][0-9０-９,，.．]*(?:\s*)(?:%|％|円|億円|兆円|人|件|年度|年|月|日|倍|割|ポイント)/;
const numericContextPattern = /(税|料金|費|予算|負担|手数料|補助|給付|率|年度|期限|tax|fee|budget|cost|rate|percent|yen)/i;

function getConfiguredLens(preferences = {}) {
  const config = preferences.data_operation_suggestions || {};
  const perspectiveId = config.default_perspective || "liberal";
  const configured = config.perspectives?.[perspectiveId] || {};

  return {
    ...defaultLiberalLens,
    ...configured,
    dimensions: Array.isArray(configured.dimensions) && configured.dimensions.length > 0
      ? configured.dimensions
      : defaultLiberalLens.dimensions
  };
}

function recordText(record) {
  return [
    record.title,
    ...(record.facts || []),
    ...(record.inferences || []),
    ...(record.unverified_points || []),
    record.notes
  ].filter(Boolean).join(" ");
}

function countMatches(records, terms) {
  const normalizedTerms = (terms || []).map((term) => String(term || "").toLowerCase()).filter(Boolean);
  return records.filter((record) => {
    const text = recordText(record).toLowerCase();
    return normalizedTerms.some((term) => text.includes(term));
  }).length;
}

function countBy(records, key) {
  const counts = new Map();
  for (const record of records) {
    const value = String(record[key] || "unknown");
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function countNumericFacts(records) {
  return records.flatMap((record) => record.facts || []).filter((fact) => {
    const text = String(fact || "");
    if (!/[0-9０-９]/.test(text)) return false;
    if (/^section\s+[0-9０-９]+\b/i.test(text)) return false;
    return numericUnitPattern.test(text) || numericContextPattern.test(text);
  }).length;
}

function hasDatedRecords(records) {
  return records.some((record) => record.published_at || record.fetched_at);
}

function hasUnverified(records) {
  return records.some((record) => {
    return record.confidence !== "high" || (record.unverified_points || []).length > 0;
  });
}

function compactCounts(counts, max = 4) {
  return counts.slice(0, max).map(([key, count]) => `${key}: ${count}`).join(", ");
}

function operation(id, title, action, question, fields, caveat, priority, trigger = "") {
  return { id, title, action, question, fields, caveat, priority, trigger };
}

export function suggestDataOperations(topic, records, preferences = {}) {
  const lens = getConfiguredLens(preferences);
  const enabled = preferences.data_operation_suggestions?.enabled !== false;
  if (!enabled || records.length === 0) return { lens, suggestions: [] };

  const sourceCounts = countBy(records, "source_type");
  const confidenceCounts = countBy(records, "confidence");
  const retrievalCounts = countBy(records, "retrieval_method");
  const dimensionHits = lens.dimensions.map((dimension) => ({
    ...dimension,
    hits: countMatches(records, dimension.terms)
  }));
  const numericFacts = countNumericFacts(records);
  const suggestions = [];

  suggestions.push(operation(
    "source_confidence_matrix",
    "出典タイプと信頼度のマトリクス化",
    "source_type と confidence で groupBy し、件数と代表的な fact を並べる。",
    "政府・企業・報道など発信主体の主張を同じ重みで扱っていないかを確認する。",
    ["source_type", "confidence", "source_name", "facts"],
    `現在の分布: source_type(${compactCounts(sourceCounts)}), confidence(${compactCounts(confidenceCounts)})。`,
    "high"
  ));

  suggestions.push(operation(
    "liberal_dimension_tagging",
    `${lens.label}の軸でタグ付け`,
    "facts を観点別キーワードで tag し、個人の自由、政府権限、市場競争、透明性、多元性ごとに件数を出す。",
    "政策や発表が自由を広げる話なのか、権限・義務・負担を増やす話なのかを分けて俯瞰する。",
    ["facts", "title", "notes", "related_entities"],
    `キーワード一致件数: ${dimensionHits.map((item) => `${item.label}: ${item.hits}`).join(", ")}。一致しない事実も「その他」として残す。`,
    "high"
  ));

  if (numericFacts > 0) {
    suggestions.push(operation(
      "burden_benefit_number_table",
      "負担・便益・権限の数値テーブル化",
      "数値を含む facts を抽出し、税・手数料・補助・給付・規制コスト・期限に分類する。",
      "自由主義的に重要な、誰が支払い、誰が権限を得て、誰の選択肢が広がるかを比較する。",
      ["facts", "published_at", "source_name", "confidence"],
      `${numericFacts} 件の数値入り fact がある。金額や率はPDF表からの抽出誤差に注意する。`,
      "high",
      "numeric_facts"
    ));
  }

  if (hasDatedRecords(records)) {
    suggestions.push(operation(
      "timeline_view",
      "時系列への並べ替え",
      "published_at を優先し、なければ fetched_at で sort して、発表、制度化、実施予定を分ける。",
      "自由への影響が一時的な発表か、実際の制度変更か、将来の義務化かを切り分ける。",
      ["published_at", "fetched_at", "title", "facts"],
      "published_at が unknown の資料は別枠にし、取得日と発生日を混同しない。",
      "medium",
      "dated_records"
    ));
  }

  suggestions.push(operation(
    "actor_power_matrix",
    "主体別の権限・負担マトリクス化",
    "source_name と related_entities ごとに、権限を持つ主体、費用を負う主体、便益を受ける主体を列に分ける。",
    "国家、自治体、企業、個人の間で権限と負担がどちらへ移るかを見る。",
    ["source_name", "related_entities", "facts", "inferences"],
    "自動抽出だけでは主体の受益・負担を断定しない。空欄を許容して追加確認候補に回す。",
    "medium"
  ));

  if (hasUnverified(records)) {
    suggestions.push(operation(
      "verification_queue",
      "追加検証キューの作成",
      "accuracy_review.score が低い record、confidence が high ではない record、unverified_points がある record を先頭に並べる。",
      "自由や権限に関する評価を、未確認資料や抽出警告に依存していないか確認する。",
      ["accuracy_review", "confidence", "unverified_points", "retrieval_method", "pdf_analysis"],
      `retrieval_method の分布: ${compactCounts(retrievalCounts)}。PDF/OCR由来の数値は原典確認を優先する。`,
      "high",
      "unverified_or_medium_confidence"
    ));
  }

  return {
    lens: {
      id: lens.id,
      label: lens.label,
      description: lens.description,
      dimensions: lens.dimensions.map((dimension) => ({
        id: dimension.id,
        label: dimension.label,
        terms: dimension.terms
      }))
    },
    suggestions
  };
}
