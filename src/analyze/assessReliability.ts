const highSourceTypes = new Set([
  "official_government",
  "official_parliament",
  "official_local_government",
  "official_court_or_law",
  "official_company",
  "database"
]);

const mediumSourceTypes = new Set([
  "news_media",
  "think_tank",
  "academic",
  "ngo"
]);

const lowSourceTypes = new Set([
  "social_media",
  "blog",
  "unknown"
]);

function hasCriticalExtractionWarning(record) {
  const text = (record.unverified_points || []).join(" ").toLowerCase();
  return /no embedded text|no readable body text|could not be extracted|ocr was needed|fetch failed/.test(text);
}

function hasExtractionCaution(record) {
  if ((record.unverified_points || []).length > 0) return true;
  if (record.pdf_analysis?.extraction?.duplicate_text_lines_skipped > 0) return true;
  return false;
}

export function assessReliability(record) {
  if (record.document_type === "error") {
    return { ...record, confidence: "low" };
  }

  if (!record.facts || record.facts.length === 0) {
    return { ...record, confidence: "low" };
  }

  if (hasCriticalExtractionWarning(record)) {
    return { ...record, confidence: "low" };
  }

  if (highSourceTypes.has(record.source_type) && record.retrieval_method !== "search") {
    if (hasExtractionCaution(record)) return { ...record, confidence: "medium" };
    return { ...record, confidence: "high" };
  }

  if (mediumSourceTypes.has(record.source_type)) {
    if (hasExtractionCaution(record)) return { ...record, confidence: "low" };
    return { ...record, confidence: "medium" };
  }

  if (lowSourceTypes.has(record.source_type)) {
    return { ...record, confidence: "low" };
  }

  return { ...record, confidence: record.confidence || "medium" };
}
