import { suggestDataOperations } from "../analyze/dataOperationSuggestions.ts";
import { reviewEvidenceQuality } from "../analyze/evidenceQuality.ts";

function bulletLines(values) {
  const clean = values.filter(Boolean);
  return clean.length ? clean.map((value) => `- ${value}`).join("\n") : "- なし";
}

function renderDataOperationSuggestions(topic, records, preferences) {
  const result = suggestDataOperations(topic, records, preferences);
  if (!result.suggestions.length) return "- なし";

  const intro = `観点: ${result.lens.label} - ${result.lens.description}\n注意: ここは調査結論ではなく、調査結果を俯瞰するためのデータ操作案です。`;
  const lines = result.suggestions.map((suggestion) => {
    return [
      `- ${suggestion.title}`,
      `  - 操作: ${suggestion.action}`,
      `  - 見る問い: ${suggestion.question}`,
      `  - 使う列: ${suggestion.fields.join(", ")}`,
      `  - 注意: ${suggestion.caveat}`
    ].join("\n");
  });

  return `${intro}\n\n${lines.join("\n")}`;
}

function renderEvidenceQuality(records) {
  const review = reviewEvidenceQuality(records);
  const summary = bulletLines(review.summary);
  const queue = review.queue.length
    ? review.queue.map((item) => {
      return `- ${item.title} (${item.source_name}) - score: ${item.score}, flags: ${item.flags.join(", ")}; action: ${item.suggested_action}`;
    }).join("\n")
    : "- なし";

  return `### 概況\n\n${summary}\n\n### 優先確認\n\n${queue}`;
}

export function renderMarkdownReport(topic, records, now = new Date(), browserTasks = [], preferences = {}) {
  const facts = records.flatMap((record) => record.facts.map((fact) => `${fact} (${record.source_name})`));
  const inferences = records.flatMap((record) => record.inferences || []);
  const unverified = records.flatMap((record) => record.unverified_points || []);
  const sources = records.map((record) => {
    const href = displayHref(record);
    return `- [${record.title || record.source_name}](${href}) - ${record.source_name}, published_at: ${record.published_at || "unknown"}, fetched_at: ${record.fetched_at}, retrieval_method: ${record.retrieval_method}, access_scope: ${record.access_scope}, confidence: ${record.confidence}`;
  });
  const taskLines = browserTasks.map((task) => `- ${task.source_name}: ${task.reason} (${task.url})`);

  return `# ${topic.name}

Generated at: ${now.toISOString()}

## 事実

${bulletLines(facts)}

## 推測

${bulletLines(inferences)}

## 未確認点

${bulletLines(unverified)}

## 精度レビュー

${renderEvidenceQuality(records)}

## データ操作サジェスト（自由主義的観点）

${renderDataOperationSuggestions(topic, records, preferences)}

## 出典

${sources.length ? sources.join("\n") : "- なし"}

## 追加確認が必要な資料

${taskLines.length ? taskLines.join("\n") : "- なし"}
`;
}

function displayHref(record) {
  if (String(record.url || "").startsWith("data:")) {
    return record.pdf_analysis?.pdf_path || record.url;
  }
  return record.url;
}
