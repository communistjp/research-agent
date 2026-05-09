import { normalizeAccessScope } from "../safety/policyCheck.ts";
import { extractFactsFromText, summarizeText } from "../analyze/extractFacts.ts";

function stripHtml(html) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleFromHtml(html, fallback) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? stripHtml(match[1]) : fallback;
}

function metaContent(html, name) {
  const patterns = [
    new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+property=["']${name}["'][^>]+content=["']([^"']+)["']`, "i")
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return stripHtml(match[1]);
  }
  return "";
}

function extractMainText(html) {
  const paragraphMatches = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)];
  const paragraphs = paragraphMatches.map((match) => stripHtml(match[1])).filter((text) => text.length > 40);
  if (paragraphs.length > 0) return paragraphs.join(" ");
  return stripHtml(html);
}

export async function collectPublicHtml(source, topic, now = new Date()) {
  const response = await fetch(source.url, {
    headers: { "user-agent": "research-agent/0.1 minimal public HTML collector" }
  });
  if (!response.ok) {
    throw new Error(`HTML fetch failed for ${source.id}: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const text = extractMainText(html).slice(0, 3000);
  const publishedAt = metaContent(html, "article:published_time") || metaContent(html, "date") || metaContent(html, "pubdate");
  const description = metaContent(html, "description") || metaContent(html, "og:description");
  const contentForFacts = description || text;

  return [{
    topic: topic.name,
    source_type: source.source_type,
    source_name: source.name,
    url: source.url,
    title: titleFromHtml(html, source.name),
    author_or_speaker: "",
    published_at: publishedAt,
    fetched_at: now.toISOString(),
    retrieval_method: "public_html",
    access_scope: normalizeAccessScope(source.access_scope),
    document_type: "html_page",
    facts: extractFactsFromText(contentForFacts, { keywords: topic.keywords }),
    inferences: [],
    unverified_points: text ? [] : ["No readable body text extracted."],
    related_entities: topic.keywords,
    confidence: "medium",
    notes: `Collected from public HTML without login or access-control bypass. Summary: ${summarizeText(contentForFacts, 2, { keywords: topic.keywords })}`
  }];
}
