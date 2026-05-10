import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { collectApi } from "./collect/apiFetch.ts";
import { collectPublicHtml } from "./collect/articleFetch.ts";
import { collectOfficialCsv } from "./collect/csvFetch.ts";
import { collectOfficialPdf } from "./collect/pdfFetch.ts";
import { makeBrowserVerificationTask, writeBrowserTasks } from "./collect/browserResearch.ts";
import { collectRss } from "./collect/rss.ts";
import { assessReliability } from "./analyze/assessReliability.ts";
import { deduplicate } from "./analyze/deduplicate.ts";
import { classifyTopic } from "./analyze/classifyTopic.ts";
import { annotateRecordAccuracy } from "./analyze/evidenceQuality.ts";
import { isRelevantToTopic } from "./analyze/topicRelevance.ts";
import { renderMarkdownReport } from "./report/markdownReport.ts";
import { writeMobileNewsReport } from "./report/mobileNewsReport.ts";
import { assertSourcePolicy } from "./safety/policyCheck.ts";
import { checkRobotsAllowed } from "./safety/robotsCheck.ts";
import { checkSourceTerms } from "./safety/sourceTermsCheck.ts";
import { persistRun } from "./store/jsonStore.ts";

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function readOptionalJson(path, fallback) {
  try {
    return await readJson(path);
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function preflightSource(source) {
  assertSourcePolicy(source);
  if (!source.enabled) return { notes: [] };
  if (source.method === "manual_check") {
    return { notes: ["Manual-check source; automated collection was not attempted."] };
  }

  const terms = await checkSourceTerms(source);
  if (!terms.allowed) {
    throw new Error(`Source terms block collection for ${source.id}: ${terms.notes.join(" ")}`);
  }

  const robots = await checkRobotsAllowed(source.url);
  if (!robots.allowed) {
    throw new Error(`robots.txt blocks collection for ${source.id}: ${robots.notes.join(" ")}`);
  }

  return {
    notes: [...terms.notes, ...robots.notes],
    terms,
    robots
  };
}

function withPreflight(records, preflight) {
  return records.map((record) => ({
    ...record,
    policy_checks: {
      source_terms: preflight.terms || null,
      robots: preflight.robots || null
    },
    notes: [record.notes, ...preflight.notes].filter(Boolean).join(" ")
  }));
}

async function collectForSource(source, topic, now) {
  const preflight = await preflightSource(source);
  if (!source.enabled) return [];

  if (source.method === "rss") return withPreflight(await collectRss(source, topic, now), preflight);
  if (source.method === "api") return withPreflight(await collectApi(source, topic, now), preflight);
  if (source.method === "official_csv") return withPreflight(await collectOfficialCsv(source, topic, now), preflight);
  if (source.method === "official_pdf") return withPreflight(await collectOfficialPdf(source, topic, process.cwd(), now), preflight);
  if (source.method === "public_html") return withPreflight(await collectPublicHtml(source, topic, now), preflight);

  const manualCheck = source.method === "manual_check";
  return [{
    topic: topic.name,
    source_type: source.source_type,
    source_name: source.name,
    url: source.url,
    title: source.name,
    author_or_speaker: "",
    published_at: "",
    fetched_at: now.toISOString(),
    retrieval_method: source.method,
    access_scope: source.access_scope,
    document_type: "configured_source",
    facts: [],
    inferences: [],
    unverified_points: [manualCheck
      ? "Source is enabled for manual review only; no automated article collection was attempted."
      : `Collection method ${source.method} is configured but not implemented in the minimal agent.`],
    related_entities: topic.keywords,
    confidence: "low",
    notes: manualCheck
      ? "Promoted as a source candidate that requires terms, robots, feed/API, and quality review before automated collection."
      : "Skipped by minimal implementation."
  }];
}

async function main() {
  const root = process.cwd();
  const now = new Date();
  const runId = now.toISOString().replaceAll(":", "-");
  const topics = await readJson(join(root, "config", "watch_topics.json"));
  const sources = await readJson(join(root, "config", "sources.json"));
  const browserPolicy = await readJson(join(root, "config", "browser_policy.json"));
  const researchPreferences = await readOptionalJson(join(root, "config", "research_preferences.json"), {});
  const allRecords = [];
  const allBrowserTasks = [];

  await mkdir(join(root, "outputs", "raw"), { recursive: true });
  await mkdir(join(root, "outputs", "reports"), { recursive: true });
  await mkdir(join(root, "outputs", "browser_tasks"), { recursive: true });
  await mkdir(join(root, "outputs", "store"), { recursive: true });

  for (const topic of topics.filter((item) => item.enabled)) {
    const topicSources = sources.filter((source) => topic.source_ids.includes(source.id));
    const collected = [];
    const browserTasks = [];

    for (const source of topicSources) {
      try {
        collected.push(...await collectForSource(source, topic, now));
      } catch (error) {
        if (browserTasks.length < (browserPolicy.max_browser_tasks_per_run || 5)) {
          browserTasks.push(makeBrowserVerificationTask(
            source,
            topic,
            `Automated collection failed or was blocked; manually verify only a small visible sample if this is within the site's terms. Error: ${error.message}`,
            now
          ));
        }
        collected.push({
          topic: topic.name,
          source_type: source.source_type || "unknown",
          source_name: source.name || source.id,
          url: source.url || "",
          title: `${source.name || source.id} fetch error`,
          author_or_speaker: "",
          published_at: "",
          fetched_at: now.toISOString(),
          retrieval_method: source.method || "unknown",
          access_scope: source.access_scope || "unknown",
          document_type: "error",
          facts: [],
          inferences: [],
          unverified_points: [error.message],
          related_entities: topic.keywords,
          confidence: "low",
          notes: "Fetch failed; no automated browser fallback was attempted. A limited manual browser verification task may be queued."
        });
      }
    }

    const records = deduplicate(collected)
      .filter((record) => isRelevantToTopic(record, topic))
      .map((record) => classifyTopic(record, topics))
      .map((record) => assessReliability(record))
      .map((record) => annotateRecordAccuracy(record, topic));
    const rawPath = join(root, "outputs", "raw", `${topic.id}.json`);
    const reportPath = join(root, "outputs", "reports", `${topic.id}.md`);
    const browserTaskPath = await writeBrowserTasks(root, browserTasks, topic.id);

    await writeFile(rawPath, JSON.stringify(records, null, 2), "utf8");
    await writeFile(reportPath, renderMarkdownReport(topic, records, now, browserTasks, researchPreferences), "utf8");
    allRecords.push(...records);
    allBrowserTasks.push(...browserTasks);

    console.log(`Wrote ${records.length} records to ${rawPath}`);
    console.log(`Wrote report to ${reportPath}`);
    if (browserTaskPath) console.log(`Wrote browser verification tasks to ${browserTaskPath}`);
  }

  const storePaths = await persistRun(root, {
    run_id: runId,
    started_at: now.toISOString(),
    topics: topics.filter((item) => item.enabled).map((item) => item.id),
    records: allRecords,
    browser_tasks: allBrowserTasks
  });
  const storedRecords = await readOptionalJson(storePaths.recordsPath, allRecords);
  const mobileReportPath = await writeMobileNewsReport(root, {
    records: storedRecords,
    topics,
    generatedAt: now,
    browserTasks: allBrowserTasks
  });
  console.log(`Updated persistent store at ${storePaths.recordsPath}`);
  console.log(`Wrote mobile news dashboard to ${mobileReportPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
