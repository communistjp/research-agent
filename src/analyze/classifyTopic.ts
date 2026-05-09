export function classifyTopic(record, topics) {
  const haystack = `${record.title} ${record.facts.join(" ")}`.toLowerCase();
  const matches = topics
    .filter((topic) => topic.enabled)
    .filter((topic) => topic.keywords.some((keyword) => haystack.includes(keyword.toLowerCase())))
    .map((topic) => topic.name);

  return {
    ...record,
    related_entities: Array.from(new Set([...(record.related_entities || []), ...matches]))
  };
}
