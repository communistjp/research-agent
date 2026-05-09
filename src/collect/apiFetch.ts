import { normalizeAccessScope } from "../safety/policyCheck.ts";
import { extractFactsFromText, summarizeText } from "../analyze/extractFacts.ts";

export async function collectApi(source, topic, now = new Date()) {
  const response = await fetch(source.url, {
    headers: { "accept": "application/json", "user-agent": "research-agent/0.1 minimal API collector" }
  });
  if (!response.ok) {
    throw new Error(`API fetch failed for ${source.id}: ${response.status} ${response.statusText}`);
  }

  const json = await response.json();
  const records = Array.isArray(json) ? json : Array.isArray(json.items) ? json.items : [json];

  return records.slice(0, source.max_records || 10).map((record, index) => {
    const body = record.summary || record.description || record.body || JSON.stringify(record).slice(0, 1000);
    return {
      topic: topic.name,
      source_type: source.source_type,
      source_name: source.name,
      url: record.url || record.link || source.url,
      title: record.title || record.name || `${source.name} API record ${index + 1}`,
      author_or_speaker: record.author || record.speaker || "",
      published_at: record.published_at || record.publishedAt || record.date || "",
      fetched_at: now.toISOString(),
      retrieval_method: "api",
      access_scope: normalizeAccessScope(source.access_scope),
      document_type: "api_record",
      facts: extractFactsFromText(body),
      inferences: [],
      unverified_points: [],
      related_entities: topic.keywords,
      confidence: "high",
      notes: `Collected from configured API endpoint. Summary: ${summarizeText(body, 1)}`
    };
  });
}
