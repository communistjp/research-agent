import { normalizeAccessScope } from "../safety/policyCheck.ts";
import { extractFactsFromText, summarizeText } from "../analyze/extractFacts.ts";

function decodeHtmlEntities(text) {
  const named = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: "\"",
    apos: "'",
    nbsp: " "
  };
  return String(text || "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
      const lower = entity.toLowerCase();
      if (lower.startsWith("#x")) {
        const codePoint = Number.parseInt(lower.slice(2), 16);
        return Number.isFinite(codePoint) && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match;
      }
      if (lower.startsWith("#")) {
        const codePoint = Number.parseInt(lower.slice(1), 10);
        return Number.isFinite(codePoint) && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match;
      }
      return named[lower] || match;
    });
}

function stripHtml(html) {
  return decodeHtmlEntities(html)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<(br|p|div|li|h[1-6])\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleFromHtml(html, fallback) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? stripHtml(match[1]) : fallback;
}

function attrValue(tag, attrName) {
  const pattern = new RegExp(`${attrName}\\s*=\\s*["']([^"']*)["']`, "i");
  return tag.match(pattern)?.[1] || "";
}

function metaContent(html, name) {
  const metaTags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of metaTags) {
    const key = attrValue(tag, "name") || attrValue(tag, "property") || attrValue(tag, "itemprop");
    if (key.toLowerCase() === name.toLowerCase()) return stripHtml(attrValue(tag, "content"));
  }
  return "";
}

function firstBlock(html, tagName) {
  const match = html.match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match ? match[1] : "";
}

function extractMainText(html) {
  const scoped = firstBlock(html, "article") || firstBlock(html, "main") || html;
  const paragraphMatches = [...scoped.matchAll(/<(p|li|h[1-3])\b[^>]*>([\s\S]*?)<\/\1>/gi)];
  const paragraphs = paragraphMatches.map((match) => stripHtml(match[2])).filter((text) => text.length > 30);
  if (paragraphs.length > 0) return paragraphs.join(" ");
  return stripHtml(scoped);
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
