const primarySourceTypes = new Set([
  "official_government",
  "official_parliament",
  "official_local_government",
  "official_court_or_law",
  "official_company",
  "database"
]);

const highSeverityFlags = new Set([
  "事実抽出なし",
  "取得エラー",
  "本文抽出不可",
  "OCR失敗"
]);

function textForRecord(record) {
  return [
    record.title,
    ...(record.facts || []),
    ...(record.inferences || [])
  ].filter(Boolean).join(" ").toLowerCase();
}

function hasTopicKeyword(record, topic) {
  const text = textForRecord(record);
  return (topic.keywords || []).some((keyword) => {
    const normalized = String(keyword || "").toLowerCase().trim();
    return normalized && text.includes(normalized);
  });
}

function hasPublishedDate(record) {
  return Boolean(String(record.published_at || "").trim());
}

function isPrimarySource(record) {
  return primarySourceTypes.has(record.source_type);
}

function extractionFlags(record) {
  const flags = [];
  const unverified = (record.unverified_points || []).join(" ");
  const extraction = record.pdf_analysis?.extraction;
  const layout = record.pdf_analysis?.layout?.heuristic;

  if (record.document_type === "error") flags.push("取得エラー");
  if (!(record.facts || []).length) flags.push("事実抽出なし");
  if (/No embedded text|No readable body text|could not be extracted/i.test(unverified)) flags.push("本文抽出不可");
  if (/OCR was needed but did not run successfully/i.test(unverified)) flags.push("OCR失敗");
  if ((record.unverified_points || []).length > 0) flags.push("未確認点あり");
  if (extraction?.used_ocr) flags.push("OCR由来テキストあり");
  if (extraction?.duplicate_text_lines_skipped > 0) flags.push("重複テキスト補正あり");
  if ((layout?.table_candidates || []).length > 0) flags.push("表形式の数値確認が必要");
  if (!hasPublishedDate(record)) flags.push("公開日不明");
  if (record.confidence !== "high") flags.push(`信頼度${record.confidence || "unknown"}`);

  return flags;
}

function severityFor(flags) {
  if (flags.some((flag) => highSeverityFlags.has(flag))) return "high";
  if (flags.some((flag) => /未確認|OCR|表形式|信頼度/.test(flag))) return "medium";
  if (flags.length > 0) return "low";
  return "none";
}

function scoreFor(record, topic) {
  let score = 100;
  const flags = extractionFlags(record);

  if (!isPrimarySource(record)) score -= 15;
  if (!hasTopicKeyword(record, topic)) score -= 10;
  if (!hasPublishedDate(record)) score -= 10;
  if (record.confidence === "medium") score -= 15;
  if (record.confidence === "low") score -= 35;
  if ((record.unverified_points || []).length > 0) score -= 15;
  if (record.pdf_analysis?.extraction?.used_ocr) score -= 8;
  if (record.pdf_analysis?.extraction?.duplicate_text_lines_skipped > 0) score -= 5;
  if ((record.pdf_analysis?.layout?.heuristic?.table_candidates || []).length > 0) score -= 12;
  if (!(record.facts || []).length) score -= 35;
  if (record.document_type === "error") score -= 50;
  if (flags.includes("本文抽出不可") || flags.includes("OCR失敗")) score -= 30;

  return Math.max(0, Math.min(100, score));
}

function suggestedAction(record, topic, flags) {
  if (record.document_type === "error") return "取得条件、robots、terms、URLを先に確認する。";
  if (!(record.facts || []).length) return "本文抽出またはCSV/PDFパース結果を確認し、factを手動で補う。";
  if ((record.pdf_analysis?.layout?.heuristic?.table_candidates || []).length > 0) {
    return "数値を原PDFの表と照合してからレポート本文で使う。";
  }
  if (record.pdf_analysis?.extraction?.used_ocr) return "OCR箇所をPDF画像または原文テキストで再確認する。";
  if (!hasTopicKeyword(record, topic)) return "トピック関連性を確認し、不要なら除外またはtopic keywordを見直す。";
  if (!hasPublishedDate(record)) return "公開日を原ページで確認し、時系列分析では別枠にする。";
  if (flags.length > 0) return "未確認点を解消してから推論に使う。";
  return "主要事実として利用可能。必要に応じて別系統の一次資料で照合する。";
}

export function annotateRecordAccuracy(record, topic) {
  const flags = extractionFlags(record);
  if (!isPrimarySource(record)) flags.push("一次資料以外");
  if (!hasTopicKeyword(record, topic)) flags.push("トピック語一致なし");

  return {
    ...record,
    accuracy_review: {
      score: scoreFor(record, topic),
      severity: severityFor(flags),
      flags: Array.from(new Set(flags)),
      suggested_action: suggestedAction(record, topic, flags),
      checks: {
        primary_source: isPrimarySource(record),
        topic_keyword_match: hasTopicKeyword(record, topic),
        published_at_known: hasPublishedDate(record),
        has_facts: (record.facts || []).length > 0
      }
    }
  };
}

function pct(part, total) {
  if (!total) return "0%";
  return `${Math.round((part / total) * 100)}%`;
}

export function reviewEvidenceQuality(records) {
  const total = records.length;
  const highConfidence = records.filter((record) => record.confidence === "high").length;
  const primary = records.filter((record) => record.accuracy_review?.checks?.primary_source).length;
  const topicMatched = records.filter((record) => record.accuracy_review?.checks?.topic_keyword_match).length;
  const dated = records.filter((record) => record.accuracy_review?.checks?.published_at_known).length;
  const withFlags = records.filter((record) => (record.accuracy_review?.flags || []).length > 0).length;
  const queue = [...records]
    .filter((record) => record.accuracy_review?.severity !== "none")
    .sort((a, b) => (a.accuracy_review?.score || 0) - (b.accuracy_review?.score || 0))
    .slice(0, 6)
    .map((record) => ({
      title: record.title || record.source_name,
      source_name: record.source_name,
      score: record.accuracy_review?.score,
      flags: record.accuracy_review?.flags || [],
      suggested_action: record.accuracy_review?.suggested_action
    }));

  return {
    summary: [
      `高信頼レコード: ${highConfidence}/${total} (${pct(highConfidence, total)})`,
      `一次資料・公式系: ${primary}/${total} (${pct(primary, total)})`,
      `トピック語一致: ${topicMatched}/${total} (${pct(topicMatched, total)})`,
      `公開日あり: ${dated}/${total} (${pct(dated, total)})`,
      `精度フラグあり: ${withFlags}/${total} (${pct(withFlags, total)})`
    ],
    queue
  };
}
