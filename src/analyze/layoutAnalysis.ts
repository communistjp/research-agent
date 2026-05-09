function normalizeLine(line) {
  return line.replace(/\s+/g, " ").trim();
}

function isHeading(line) {
  const text = normalizeLine(line);
  if (!text) return false;
  if (text.length > 80) return false;
  if (/^[0-9０-９]+[.)．、]\s*\S+/.test(text)) return true;
  if (/^(第[一二三四五六七八九十百千0-9０-９]+[章節条項]|[IVX]+[.)])/.test(text)) return true;
  if (!/[。.!?！？]$/.test(text) && text.length <= 40) return true;
  return false;
}

function isTableLike(line) {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (/\t/.test(trimmed)) return true;
  if (/\S\s{2,}\S/.test(line)) return true;
  if ((trimmed.match(/[|｜]/g) || []).length >= 2) return true;
  return false;
}

export function analyzeTextLayout(text, pageTexts = []) {
  const pages = pageTexts.length > 0 ? pageTexts : String(text || "").split(/\f+/);
  const headings = [];
  const table_candidates = [];
  const sections = [];

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const lines = pages[pageIndex].split(/\r?\n/);
    let currentSection = null;

    for (const rawLine of lines) {
      const line = normalizeLine(rawLine);
      if (!line) continue;

      if (isHeading(line)) {
        const heading = { page: pageIndex + 1, text: line };
        headings.push(heading);
        currentSection = { heading: line, page: pageIndex + 1, text_preview: "" };
        sections.push(currentSection);
      } else if (isTableLike(rawLine)) {
        table_candidates.push({ page: pageIndex + 1, text: line });
      } else if (currentSection && currentSection.text_preview.length < 500) {
        currentSection.text_preview = `${currentSection.text_preview} ${line}`.trim();
      }
    }
  }

  return {
    page_count_detected: pages.filter((page) => page.trim()).length || 1,
    headings: headings.slice(0, 30),
    table_candidates: table_candidates.slice(0, 30),
    sections: sections.slice(0, 30)
  };
}

export function extractPageTexts(text) {
  return String(text || "")
    .split(/\f+/)
    .map((page) => page.trim())
    .filter(Boolean);
}
