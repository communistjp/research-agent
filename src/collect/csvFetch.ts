import { extractFactsFromText, summarizeText } from "../analyze/extractFacts.ts";
import { normalizeAccessScope } from "../safety/policyCheck.ts";

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === "\"" && quoted && next === "\"") {
      current += "\"";
      index += 1;
    } else if (char === "\"") {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  values.push(current);
  return values.map((value) => value.trim());
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  const headers = parseCsvLine(lines[0]).map((header) => header.toLowerCase());
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]));
  });
}

export async function collectOfficialCsv(source, topic, now = new Date()) {
  const response = await fetch(source.url, {
    headers: { "user-agent": "research-agent/0.1 official CSV collector" }
  });
  if (!response.ok) {
    throw new Error(`CSV fetch failed for ${source.id}: ${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  const rows = parseCsv(text).slice(0, source.max_records || 25);

  return rows.map((row, index) => {
    const summary = row.summary || row.description || row.body || JSON.stringify(row);
    return {
      topic: topic.name,
      source_type: source.source_type,
      source_name: source.name,
      url: row.url || row.link || source.url,
      title: row.title || row.name || `${source.name} CSV row ${index + 1}`,
      author_or_speaker: row.author || row.speaker || "",
      published_at: row.published_at || row.publishedat || row.date || "",
      fetched_at: now.toISOString(),
      retrieval_method: "official_csv",
      access_scope: normalizeAccessScope(source.access_scope),
      document_type: "csv_row",
      facts: extractFactsFromText(summary, { keywords: topic.keywords }),
      inferences: [],
      unverified_points: [],
      related_entities: topic.keywords,
      confidence: "high",
      notes: `Collected from official CSV. Summary: ${summarizeText(summary, 1, { keywords: topic.keywords })}`
    };
  });
}
