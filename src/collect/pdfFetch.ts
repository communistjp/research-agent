import { normalizeAccessScope } from "../safety/policyCheck.ts";
import { extractFactsFromText, summarizeText } from "../analyze/extractFacts.ts";
import { analyzePdfBuffer } from "./pdfTools.ts";

export async function collectOfficialPdf(source, topic, root, now = new Date()) {
  const response = await fetch(source.url, {
    headers: { "user-agent": "research-agent/0.1 official PDF collector" }
  });
  if (!response.ok) {
    throw new Error(`PDF fetch failed for ${source.id}: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") || "application/pdf";
  const buffer = Buffer.from(await response.arrayBuffer());
  const analysis = await analyzePdfBuffer(buffer, source, root, now);
  const text = analysis.text || "";
  const facts = extractFactsFromText(text, { maxFacts: 5, keywords: topic.keywords });
  const unverified = [];

  if (!text.trim()) {
    unverified.push("No embedded text or OCR text could be extracted from this PDF in the current local environment.");
  }
  if (analysis.extraction.ocr_attempted && !analysis.extraction.used_ocr) {
    unverified.push("OCR was needed but did not run successfully; install pdftoppm and tesseract for scanned administrative PDFs.");
  }
  if (analysis.layout.heuristic.table_candidates.length > 0) {
    unverified.push("Table-like lines were detected; numeric values should be manually verified against the original PDF before citation.");
  }

  return [{
    topic: topic.name,
    source_type: source.source_type,
    source_name: source.name,
    url: source.url,
    title: source.title || source.name,
    author_or_speaker: source.author_or_speaker || "",
    published_at: source.published_at || analysis.metadata.creationdate || "",
    fetched_at: now.toISOString(),
    retrieval_method: "official_pdf",
    access_scope: normalizeAccessScope(source.access_scope),
    document_type: "pdf",
    facts: facts.length ? facts : [`Fetched official PDF metadata: ${buffer.length} bytes, content-type ${contentType}.`],
    inferences: [],
    unverified_points: unverified,
    related_entities: topic.keywords,
    confidence: "high",
    pdf_analysis: {
      pdf_path: analysis.pdf_path,
      metadata: analysis.metadata,
      extraction: analysis.extraction,
      layout: analysis.layout
    },
    notes: `Collected official PDF without paywall or access-control bypass. Summary: ${summarizeText(text, 2, { keywords: topic.keywords })}`
  }];
}
