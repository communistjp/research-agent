import { parseArgs, csv, requireArg } from "./args.ts";
import { readJsonConfig, slugify, uniqueById, writeJsonConfig } from "../config/configIo.ts";
import { assertSourcePolicy } from "../safety/policyCheck.ts";
import { checkRobotsAllowed } from "../safety/robotsCheck.ts";
import { checkSourceTerms } from "../safety/sourceTermsCheck.ts";

function inferMethod(url, explicit) {
  if (explicit) return explicit;
  const lower = String(url).toLowerCase().split("?")[0];
  if (lower.endsWith(".rss") || lower.endsWith(".xml") || lower.includes("/rss") || lower.includes("feed")) return "rss";
  if (lower.endsWith(".csv")) return "official_csv";
  if (lower.endsWith(".pdf")) return "official_pdf";
  if (lower.includes("api")) return "api";
  return "public_html";
}

function inferSourceType(value) {
  return value || "unknown";
}

async function main() {
  const root = process.cwd();
  const args = parseArgs(process.argv.slice(2));
  const url = requireArg(args, "url");
  const name = requireArg(args, "name");
  const id = args.id || slugify(name);
  const method = inferMethod(url, args.method);
  const termsStatus = args.termsStatus || "unknown";
  const accessScope = args.accessScope || "public";
  const sourceType = inferSourceType(args.sourceType);
  const topicsToLink = csv(args.topic || args.topics);

  const source = {
    id,
    name,
    source_type: sourceType,
    url,
    terms_status: termsStatus,
    ...(args.termsUrl ? { terms_url: args.termsUrl } : {}),
    method,
    access_scope: accessScope,
    enabled: Boolean(args.enable)
  };

  if (method === "official_pdf") {
    source.enable_ocr = args.enableOcr !== "false";
    source.ocr_lang = args.ocrLang || "jpn+eng";
    source.ocr_max_pages = Number(args.ocrMaxPages || 10);
    source.ocr_dpi = Number(args.ocrDpi || 300);
    source.ocr_min_chars = Number(args.ocrMinChars || 200);
  }

  const checkTarget = { ...source, enabled: true };
  assertSourcePolicy(checkTarget);
  const terms = await checkSourceTerms(checkTarget);
  const robots = await checkRobotsAllowed(checkTarget.url);

  source.safety_review = {
    reviewed_at: new Date().toISOString(),
    source_terms: terms,
    robots
  };

  if (!terms.allowed || !robots.allowed) {
    source.enabled = false;
    source.safety_review.decision = "blocked";
  } else if (source.enabled && (!terms.checked || !robots.checked)) {
    source.enabled = false;
    source.safety_review.decision = "added_disabled_until_reviewed";
  } else {
    source.safety_review.decision = source.enabled ? "enabled" : "added_disabled";
  }

  if (args.dryRun) {
    console.log(JSON.stringify(source, null, 2));
    console.log("Dry run: sources.json was not changed.");
    return;
  }

  const sources = await readJsonConfig(root, "sources.json", []);
  const existingIndex = sources.findIndex((item) => item.id === id);
  if (existingIndex >= 0) {
    sources[existingIndex] = { ...sources[existingIndex], ...source };
    console.log(`Updated source ${id}`);
  } else {
    sources.push(source);
    console.log(`Added source ${id}`);
  }
  await writeJsonConfig(root, "sources.json", uniqueById(sources));

  if (topicsToLink.length > 0) {
    const topics = await readJsonConfig(root, "watch_topics.json", []);
    for (const topicId of topicsToLink) {
      const topic = topics.find((item) => item.id === topicId);
      if (!topic) {
        console.warn(`Topic not found, skipped link: ${topicId}`);
        continue;
      }
      topic.source_ids = Array.from(new Set([...(topic.source_ids || []), id]));
    }
    await writeJsonConfig(root, "watch_topics.json", uniqueById(topics));
  }

  console.log(`method=${method}`);
  console.log(`enabled=${source.enabled}`);
  console.log(`terms=${terms.allowed ? "allowed" : "blocked"} checked=${terms.checked}`);
  console.log(`robots=${robots.allowed ? "allowed" : "blocked"} checked=${robots.checked}`);
  if (source.safety_review.decision === "added_disabled_until_reviewed") {
    console.log("Added disabled because terms or robots could not be fully checked.");
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
