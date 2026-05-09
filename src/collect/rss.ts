import { normalizeAccessScope } from "../safety/policyCheck.ts";
import { extractFactsFromText, summarizeText } from "../analyze/extractFacts.ts";

function textBetween(input, tag) {
  const match = input.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  if (!match) return "";
  return decodeXml(match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")).trim();
}

function decodeXml(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'");
}

function extractItems(xml) {
  const matches = xml.match(/<item\b[\s\S]*?<\/item>|<entry\b[\s\S]*?<\/entry>/gi) || [];
  return matches.slice(0, 10);
}

export async function collectRss(source, topic, now = new Date()) {
  const response = await fetch(source.url, {
    headers: { "user-agent": "research-agent/0.1 minimal RSS collector" }
  });
  if (!response.ok) {
    throw new Error(`RSS fetch failed for ${source.id}: ${response.status} ${response.statusText}`);
  }

  const xml = await response.text();
  return extractItems(xml).map((item) => {
    const title = textBetween(item, "title");
    const link = textBetween(item, "link") || (item.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1] ?? source.url);
    const publishedAt = textBetween(item, "pubDate") || textBetween(item, "published") || textBetween(item, "updated");
    const summary = textBetween(item, "description") || textBetween(item, "summary") || textBetween(item, "content");

    return {
      topic: topic.name,
      source_type: source.source_type,
      source_name: source.name,
      url: link,
      title,
      author_or_speaker: textBetween(item, "author") || "",
      published_at: publishedAt,
      fetched_at: now.toISOString(),
      retrieval_method: "rss",
      access_scope: normalizeAccessScope(source.access_scope),
      document_type: "rss_item",
      facts: extractFactsFromText(summary || title, { keywords: topic.keywords }),
      inferences: [],
      unverified_points: [],
      related_entities: topic.keywords,
      confidence: "high",
      notes: `Collected from official RSS feed. Summary: ${summarizeText(summary || title, 1, { keywords: topic.keywords })}`
    };
  });
}
