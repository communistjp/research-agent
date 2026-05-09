function bulletLines(values) {
  const clean = values.filter(Boolean);
  return clean.length ? clean.map((value) => `- ${value}`).join("\n") : "- なし";
}

export function renderMarkdownReport(topic, records, now = new Date(), browserTasks = []) {
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
