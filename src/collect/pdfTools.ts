import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { analyzeTextLayout, extractPageTexts } from "../analyze/layoutAnalysis.ts";

function findLocalCommand(command) {
  const executable = process.platform === "win32" && !command.endsWith(".exe") ? `${command}.exe` : command;
  const toolsDir = join(process.cwd(), "tools");
  if (!existsSync(toolsDir)) return null;

  const stack = [toolsDir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = readdirSync(current);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = join(current, entry);
      let stat = null;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.toLowerCase() === executable.toLowerCase()) {
        return fullPath;
      }
    }
  }

  return null;
}

function resolveCommand(command) {
  const local = findLocalCommand(command);
  if (local) return local;

  const checker = process.platform === "win32" ? "where.exe" : "command";
  const args = process.platform === "win32" ? [command] : ["-v", command];
  const result = spawnSync(checker, args, { encoding: "utf8", shell: process.platform !== "win32" });
  if (result.status !== 0) return null;
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)[0] || command;
}

function runCommand(commandPath, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(commandPath, args, {
      cwd: options.cwd,
      shell: false,
      windowsHide: true
    });
    const stdout = [];
    const stderr = [];
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
    }, options.timeoutMs || 60000);

    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({
        ok: code === 0,
        code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8")
      });
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      resolve({ ok: false, code: -1, stdout: "", stderr: error.message });
    });
  });
}

function safeFileName(input) {
  return basename(String(input || "document"))
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "document";
}

function parsePdfInfo(output) {
  const info = {};
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1].trim().toLowerCase().replace(/\s+/g, "_");
    info[key] = match[2].trim();
  }
  if (info.pages) info.pages = Number(info.pages);
  return info;
}

function parseBboxWords(xml) {
  const pages = [];
  const pageMatches = [...xml.matchAll(/<page\b([^>]*)>([\s\S]*?)<\/page>/gi)];
  for (const pageMatch of pageMatches) {
    const pageAttrs = pageMatch[1];
    const pageBody = pageMatch[2];
    const pageNumber = pages.length + 1;
    const width = Number(pageAttrs.match(/width="([^"]+)"/)?.[1] || 0);
    const height = Number(pageAttrs.match(/height="([^"]+)"/)?.[1] || 0);
    const words = [...pageBody.matchAll(/<word\b([^>]*)>([\s\S]*?)<\/word>/gi)].map((match) => {
      const attrs = match[1];
      return {
        text: match[2].replace(/<[^>]+>/g, "").trim(),
        x_min: Number(attrs.match(/xMin="([^"]+)"/)?.[1] || 0),
        y_min: Number(attrs.match(/yMin="([^"]+)"/)?.[1] || 0),
        x_max: Number(attrs.match(/xMax="([^"]+)"/)?.[1] || 0),
        y_max: Number(attrs.match(/yMax="([^"]+)"/)?.[1] || 0)
      };
    }).filter((word) => word.text);
    pages.push({ page: pageNumber, width, height, words: words.slice(0, 1000) });
  }
  return pages;
}

function pdfTextHints(buffer) {
  const ascii = Buffer.from(buffer)
    .toString("latin1")
    .replace(/[^\x20-\x7E\n\r\t]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const matches = [...ascii.matchAll(/\(([^()]{8,500})\)/g)].map((match) => match[1]);
  return matches.slice(0, 20);
}

function cleanPdfLine(line) {
  return String(line || "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

function pdfLineFingerprint(line) {
  return cleanPdfLine(line)
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

function isNearDuplicatePdfLine(candidate, existing) {
  const candidateKey = pdfLineFingerprint(candidate);
  const existingKey = pdfLineFingerprint(existing);
  if (!candidateKey || !existingKey) return false;
  if (candidateKey === existingKey) return true;
  if (candidateKey.length >= 18 && existingKey.includes(candidateKey)) return true;
  if (existingKey.length >= 18 && candidateKey.includes(existingKey)) return true;

  const longest = Math.max(candidateKey.length, existingKey.length);
  if (longest > 160) return false;
  return editDistance(candidateKey, existingKey) / longest <= 0.12;
}

function mergeDistinctPdfTextParts(parts) {
  const lines = [];
  let skipped = 0;

  for (const part of parts) {
    const partLines = String(part || "")
      .split(/\r?\n|\f+/)
      .map((line) => cleanPdfLine(line))
      .filter(Boolean);

    for (const line of partLines) {
      if (lines.some((existing) => isNearDuplicatePdfLine(line, existing))) {
        skipped += 1;
        continue;
      }
      lines.push(line);
    }
  }

  return {
    text: lines.join("\n"),
    duplicate_lines_skipped: skipped
  };
}

async function extractWithPdftotext(pdfPath) {
  const pdftotext = resolveCommand("pdftotext");
  if (!pdftotext) {
    return { ok: false, text: "", notes: ["pdftotext is not installed."], layout_pages: [] };
  }

  const textResult = await runCommand(pdftotext, ["-layout", "-enc", "UTF-8", pdfPath, "-"], { timeoutMs: 120000 });
  const bboxResult = await runCommand(pdftotext, ["-bbox-layout", "-enc", "UTF-8", pdfPath, "-"], { timeoutMs: 120000 });

  return {
    ok: textResult.ok,
    text: textResult.stdout || "",
    notes: [
      textResult.ok ? "pdftotext -layout extracted embedded text." : `pdftotext failed: ${textResult.stderr || textResult.code}`,
      bboxResult.ok ? "pdftotext -bbox-layout extracted word coordinates." : "bbox layout was unavailable."
    ],
    layout_pages: bboxResult.ok ? parseBboxWords(bboxResult.stdout) : []
  };
}

async function readPdfInfo(pdfPath) {
  const pdfinfo = resolveCommand("pdfinfo");
  if (!pdfinfo) {
    return { info: {}, notes: ["pdfinfo is not installed."] };
  }
  const result = await runCommand(pdfinfo, [pdfPath], { timeoutMs: 30000 });
  if (!result.ok) return { info: {}, notes: [`pdfinfo failed: ${result.stderr || result.code}`] };
  return { info: parsePdfInfo(result.stdout), notes: ["pdfinfo extracted PDF metadata."] };
}

async function ocrPdf(pdfPath, workDir, options) {
  if (!options.enable_ocr) {
    return { text: "", pages: [], notes: ["OCR disabled for this source."] };
  }
  const pdftoppm = resolveCommand("pdftoppm");
  const tesseract = resolveCommand("tesseract");
  if (!pdftoppm) {
    return { text: "", pages: [], notes: ["OCR skipped because pdftoppm is not installed."] };
  }

  const maxPages = Math.max(1, Math.min(Number(options.max_pages || 3), 20));
  const dpi = Math.max(150, Math.min(Number(options.dpi || 300), 600));
  const langCandidates = [options.lang || "jpn+eng", "eng"];
  const pages = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const prefix = join(workDir, `ocr-page-${page}`);
    const render = await runCommand(pdftoppm, ["-r", String(dpi), "-png", "-f", String(page), "-singlefile", pdfPath, prefix], { timeoutMs: 120000 });
    if (!render.ok) {
      pages.push({ page, text: "", confidence: "unknown", notes: [`pdftoppm failed: ${render.stderr || render.code}`] });
      break;
    }

    const imagePath = `${prefix}.png`;
    const ocrResult = tesseract
      ? await runNativeTesseract(tesseract, imagePath, langCandidates, options)
      : await runTesseractJs(imagePath, langCandidates, options);

    if (!ocrResult) {
      pages.push({ page, text: "", confidence: "unknown", notes: ["OCR failed for configured languages."] });
    } else {
      pages.push({
        page,
        text: ocrResult.result.stdout.trim(),
        confidence: "unknown",
        notes: [`OCR extracted with ${ocrResult.engine} language ${ocrResult.lang}.`]
      });
    }
  }

  return {
    text: pages.map((page) => page.text).filter(Boolean).join("\f"),
    pages,
    notes: pages.flatMap((page) => page.notes)
  };
}

async function runNativeTesseract(tesseract, imagePath, langCandidates, options) {
  for (const lang of langCandidates) {
    const result = await runCommand(tesseract, [imagePath, "stdout", "-l", lang, "--psm", String(options.psm || 6)], { timeoutMs: 180000 });
    if (result.ok) {
      return { engine: "native tesseract", lang, result };
    }
  }
  return null;
}

async function runTesseractJs(imagePath, langCandidates, options) {
  const langPath = join(process.cwd(), "tools", "tessdata-js");
  const corePath = join(process.cwd(), "node_modules", "tesseract.js-core");
  if (!existsSync(langPath)) return null;

  try {
    const { createWorker } = await import("tesseract.js");
    for (const lang of langCandidates) {
      const langs = lang.split("+").filter(Boolean);
      const hasLanguageData = langs.every((item) => existsSync(join(langPath, `${item}.traineddata.gz`)));
      if (!hasLanguageData) continue;

      const worker = await createWorker(langs, 1, {
        corePath,
        langPath,
        cachePath: langPath,
        cacheMethod: "readOnly"
      });
      await worker.setParameters({
        preserve_interword_spaces: "1",
        tessedit_pageseg_mode: String(options.psm || 6)
      });
      const ret = await worker.recognize(imagePath);
      await worker.terminate();
      return {
        engine: "tesseract.js",
        lang,
        result: { ok: true, stdout: ret.data.text || "", stderr: "" }
      };
    }
  } catch (error) {
    return null;
  }

  return null;
}

export async function analyzePdfBuffer(buffer, source, root, now = new Date()) {
  const pdfDir = join(root, "outputs", "raw", "pdf");
  await mkdir(pdfDir, { recursive: true });
  const baseName = `${safeFileName(source.id)}-${now.toISOString().replaceAll(":", "-")}`;
  const pdfPath = join(pdfDir, `${baseName}.pdf`);
  const workDir = join(pdfDir, `${baseName}-work`);
  await mkdir(workDir, { recursive: true });
  await writeFile(pdfPath, buffer);

  const infoResult = await readPdfInfo(pdfPath);
  const textResult = await extractWithPdftotext(pdfPath);
  const embeddedText = textResult.text.trim();
  const embeddedHints = embeddedText ? [] : pdfTextHints(buffer);
  const textForThreshold = embeddedText || embeddedHints.join("\n");
  const shouldOcr = textForThreshold.replace(/\s+/g, "").length < Number(source.ocr_min_chars || 200) || source.force_ocr;
  const detectedPages = Number(infoResult.info.pages || 0);
  const configuredMaxPages = Number(source.ocr_max_pages || detectedPages || 3);
  const ocrMaxPages = detectedPages > 0 ? Math.min(configuredMaxPages, detectedPages) : configuredMaxPages;
  const ocrResult = shouldOcr ? await ocrPdf(pdfPath, workDir, {
    enable_ocr: source.enable_ocr !== false,
    max_pages: ocrMaxPages,
    dpi: source.ocr_dpi || 300,
    lang: source.ocr_lang || "jpn+eng",
    psm: source.ocr_psm || 6
  }) : { text: "", pages: [], notes: ["OCR not needed; embedded text passed threshold."] };

  const mergedText = mergeDistinctPdfTextParts([embeddedText, embeddedHints.join("\n"), ocrResult.text]);
  const finalText = mergedText.text;
  const pageTexts = extractPageTexts(finalText);
  const heuristicLayout = analyzeTextLayout(finalText, pageTexts);
  const duplicateNote = mergedText.duplicate_lines_skipped > 0
    ? [`Skipped ${mergedText.duplicate_lines_skipped} near-duplicate PDF text lines from fallback or OCR output.`]
    : [];

  return {
    pdf_path: pdfPath,
    work_dir: workDir,
    text: finalText,
    page_texts: pageTexts,
    metadata: infoResult.info,
    extraction: {
      embedded_text_chars: embeddedText.length,
      fallback_hint_count: embeddedHints.length,
      ocr_text_chars: ocrResult.text.length,
      final_text_chars: finalText.length,
      duplicate_text_lines_skipped: mergedText.duplicate_lines_skipped,
      used_ocr: Boolean(ocrResult.text),
      ocr_attempted: shouldOcr,
      tool_notes: [...infoResult.notes, ...textResult.notes, ...ocrResult.notes, ...duplicateNote]
    },
    layout: {
      heuristic: heuristicLayout,
      bbox_pages: textResult.layout_pages.slice(0, 10)
    }
  };
}
