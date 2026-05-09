function normalizeForExtraction(text) {
  return String(text || "")
    .normalize("NFKC")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanText(text) {
  return normalizeForExtraction(text)
    .replace(/\s+/g, " ")
    .trim();
}

function fingerprint(text) {
  return cleanText(text)
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function editDistance(a, b) {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  if (Math.abs(a.length - b.length) > Math.max(a.length, b.length) * 0.35) return Infinity;

  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = Array.from({ length: b.length + 1 }, () => 0);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[b.length];
}

function isNearDuplicate(candidate, existing) {
  const candidateKey = fingerprint(candidate);
  const existingKey = fingerprint(existing);
  if (!candidateKey || !existingKey) return false;
  if (candidateKey === existingKey) return true;
  if (candidateKey.length >= 18 && existingKey.includes(candidateKey)) return true;
  if (existingKey.length >= 18 && candidateKey.includes(existingKey)) return true;

  const longest = Math.max(candidateKey.length, existingKey.length);
  if (longest > 160) return false;
  return editDistance(candidateKey, existingKey) / longest <= 0.12;
}

function isLowValueFragment(sentence) {
  const text = cleanText(sentence);
  if (!text) return true;
  if (/^[-*・•\s]+$/.test(text)) return true;
  if (/^(page|p)\s*\d+$/i.test(text)) return true;
  if (/^(item|ltem)\s+value\s+notes$/i.test(text)) return true;
  if (/^(項目|事項)\s+(値|金額|内容)\s+(備考|注記)$/i.test(text)) return true;
  return false;
}

function scoreSentence(sentence, keywords = []) {
  const text = cleanText(sentence);
  const lower = text.toLowerCase();
  let score = 0;

  for (const keyword of keywords || []) {
    const normalized = cleanText(keyword).toLowerCase();
    if (normalized && lower.includes(normalized)) score += 4;
  }

  if (/[0-9０-９]/.test(text)) score += 2;
  if (/%|％|円|億|兆|年度|令和|\bFY\s*\d{4}\b/i.test(text)) score += 2;
  if (/[。.!?！？]$/.test(text)) score += 1;
  if (text.length > 220) score -= 2;
  if (isLowValueFragment(text)) score -= 20;

  return score;
}

function parseOptions(maxFactsOrOptions, maybeOptions) {
  if (typeof maxFactsOrOptions === "number") {
    return {
      maxFacts: maxFactsOrOptions,
      keywords: maybeOptions?.keywords || []
    };
  }

  return {
    maxFacts: Number(maxFactsOrOptions?.maxFacts || 3),
    keywords: maxFactsOrOptions?.keywords || []
  };
}

function deduplicateSentences(sentences) {
  const result = [];
  for (const sentence of sentences) {
    if (result.some((existing) => isNearDuplicate(sentence, existing))) continue;
    result.push(sentence);
  }
  return result;
}

export function splitSentences(text) {
  const normalized = normalizeForExtraction(text);
  if (!normalized) return [];

  return normalized
    .replace(/([。！？!?])(?=\S)/g, "$1\n")
    .replace(/([.])\s+/g, "$1\n")
    .split(/\n+/)
    .map((sentence) => cleanText(sentence))
    .filter((sentence) => sentence.length >= 12)
    .filter((sentence) => !isLowValueFragment(sentence));
}

export function extractFactsFromText(text, maxFactsOrOptions = 3, maybeOptions = {}) {
  const { maxFacts, keywords } = parseOptions(maxFactsOrOptions, maybeOptions);
  const sentences = deduplicateSentences(splitSentences(text));
  if (sentences.length > 0) {
    return sentences
      .map((sentence, index) => ({ sentence, index, score: scoreSentence(sentence, keywords) }))
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, maxFacts)
      .sort((a, b) => a.index - b.index)
      .map((item) => item.sentence);
  }

  const cleaned = cleanText(text);
  return cleaned ? [cleaned.slice(0, 500)] : [];
}

export function summarizeText(text, maxSentences = 2, options = {}) {
  const facts = extractFactsFromText(text, { maxFacts: maxSentences, keywords: options.keywords || [] });
  return facts.join(" ");
}
