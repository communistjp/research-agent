import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const USER_AGENT = "research-agent/0.1 source-verifier";
const TIMEOUT_MS = 12000;
const MAX_TEXT = 30000;

function timestamp() {
  return new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
}

function isDataUrl(url) {
  return String(url || "").startsWith("data:");
}

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

function normalizeUrl(url) {
  try {
    return new URL(url).toString();
  } catch {
    return "";
  }
}

function uniq(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

async function fetchSample(url, options = {}) {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": USER_AGENT, accept: options.accept || "*/*" },
      signal: AbortSignal.timeout(options.timeoutMs || TIMEOUT_MS)
    });
    const contentType = response.headers.get("content-type") || "";
    let text = "";
    if (!options.headOnly) {
      text = (await response.text()).slice(0, MAX_TEXT);
    }
    return {
      ok: response.ok,
      status: response.status,
      status_text: response.statusText,
      final_url: response.url,
      content_type: contentType,
      elapsed_ms: Date.now() - started,
      text
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      status_text: "",
      final_url: url,
      content_type: "",
      elapsed_ms: Date.now() - started,
      error: error.message,
      text: ""
    };
  }
}

function parseRobots(text) {
  const lines = String(text || "").split(/\r?\n/);
  const groups = [];
  let current = null;

  for (const raw of lines) {
    const line = raw.split("#")[0].trim();
    if (!line) continue;
    const index = line.indexOf(":");
    if (index < 0) continue;
    const key = line.slice(0, index).trim().toLowerCase();
    const value = line.slice(index + 1).trim();
    if (key === "user-agent") {
      if (!current || current.rules.length > 0) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if ((key === "allow" || key === "disallow") && current) {
      current.rules.push({ type: key, path: value });
    }
  }

  const matching = groups.filter((group) => group.agents.includes("*") || group.agents.some((agent) => USER_AGENT.toLowerCase().includes(agent)));
  const rules = matching.flatMap((group) => group.rules);
  const disallowAll = rules.some((rule) => rule.type === "disallow" && rule.path === "/");
  const allowRoot = rules.some((rule) => rule.type === "allow" && (rule.path === "/" || rule.path === ""));

  return {
    checked: text.length > 0,
    disallow_all: disallowAll && !allowRoot,
    notes: rules.length === 0 ? "No matching user-agent rules found in sampled robots.txt." : `${rules.length} matching robots rules sampled.`
  };
}

function looksLikeFeed(result) {
  const contentType = result.content_type.toLowerCase();
  const text = result.text.slice(0, 2000).toLowerCase();
  return result.ok && (
    contentType.includes("xml") ||
    contentType.includes("rss") ||
    contentType.includes("atom") ||
    text.includes("<rss") ||
    text.includes("<feed") ||
    text.includes("<rdf:rdf")
  );
}

function countFeedItems(result) {
  return (result.text.match(/<item\b[\s\S]*?<\/item>|<entry\b[\s\S]*?<\/entry>/gi) || []).length;
}

function discoverTermsLinks(homepageResult, origin) {
  const html = homepageResult.text || "";
  const links = [];
  const linkRegex = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(linkRegex)) {
    const href = match[1];
    const label = match[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
    const candidate = `${href} ${label}`.toLowerCase();
    if (!/(terms|termsofuse|terms-of-use|user-agreement|legal|利用規約|サイトポリシー|サイトの利用|規約)/i.test(candidate)) continue;
    try {
      links.push(new URL(href, origin).toString());
    } catch {
      // Ignore malformed links.
    }
  }
  return uniq(links).slice(0, 3);
}

function scanTerms(text) {
  const lower = String(text || "").toLowerCase();
  const prohibitedPatterns = [
    /automated (collection|access|scraping).{0,100}(prohibited|forbidden|not allowed)/,
    /(scraping|crawling|robots|bots).{0,100}(prohibited|forbidden|not allowed)/,
    /(do not|may not).{0,100}(scrape|crawl|use bots|automated)/,
    /without (our )?prior written consent.{0,120}(scrape|crawl|bot|automated)/,
    /(スクレイピング|クローリング|ロボット).{0,80}(禁止|お断り|許可なく|無断)/
  ];
  return prohibitedPatterns.some((pattern) => pattern.test(lower));
}

function feedCandidatesFor(source) {
  const origin = originOf(source.url);
  if (!origin) return [];
  const candidates = [];

  if (source.method === "rss") {
    candidates.push(source.url);
  }

  candidates.push(
    `${origin}/feed/`,
    `${origin}/feed`,
    `${origin}/rss.xml`,
    `${origin}/rss`,
    `${origin}/atom.xml`,
    `${origin}/news/rss.xml`,
    `${origin}/rss/index.xml`
  );

  for (const example of source.example_urls || []) {
    try {
      const url = new URL(example);
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts.length > 0) {
        candidates.push(`${url.origin}/${parts[0]}/feed/`);
      }
    } catch {
      // Ignore malformed examples.
    }
  }

  return uniq(candidates).map(normalizeUrl).filter(Boolean).slice(0, 10);
}

function recommendation(source, robots, feedOk, terms) {
  if (isDataUrl(source.url)) return "fixture_ok";
  if (robots.decision === "blocked") return "keep_manual_check";
  if (terms.decision === "prohibited") return "keep_manual_check";
  if (feedOk) return "promote_to_rss_after_review";
  return "keep_manual_check";
}

function sourceTopics(source, topics) {
  return topics.filter((topic) => (topic.source_ids || []).includes(source.id)).map((topic) => topic.id);
}

async function verifySource(source, topics) {
  const linkedTopics = sourceTopics(source, topics);
  if (isDataUrl(source.url)) {
    return {
      id: source.id,
      name: source.name,
      source_type: source.source_type,
      method: source.method,
      enabled: source.enabled,
      url: source.url.slice(0, 80),
      linked_topics: linkedTopics,
      robots: { decision: "not_applicable", status: null, notes: "Data URL fixture." },
      homepage: { ok: true, status: null, content_type: "data-url" },
      feed: { ok: source.method === "rss", url: source.method === "rss" ? source.url.slice(0, 80) : "" },
      terms: { decision: "not_applicable", url: source.terms_url || "", notes: "Data URL fixture." },
      recommendation: "fixture_ok"
    };
  }

  const homepageUrl = source.homepage_url || source.url;
  const origin = originOf(source.url) || originOf(homepageUrl);
  const robotsUrl = `${origin}/robots.txt`;
  const robotsFetch = await fetchSample(robotsUrl, { accept: "text/plain,*/*" });
  const robotsParsed = robotsFetch.ok ? parseRobots(robotsFetch.text) : { checked: false, disallow_all: false, notes: robotsFetch.error || `${robotsFetch.status} ${robotsFetch.status_text}` };
  const robots = {
    decision: robotsParsed.disallow_all ? "blocked" : (robotsFetch.ok ? "not_blocked_by_sample" : "unknown"),
    status: robotsFetch.status,
    url: robotsUrl,
    notes: robotsParsed.notes
  };

  const homepage = await fetchSample(homepageUrl, { accept: "text/html,application/xhtml+xml,*/*" });
  const termsLinks = homepage.ok ? discoverTermsLinks(homepage, origin) : [];
  let terms = {
    decision: termsLinks.length > 0 ? "link_found_unchecked" : "not_found",
    url: termsLinks[0] || "",
    notes: termsLinks.length > 0 ? "Terms/legal link discovered from homepage." : "No terms/legal link discovered from homepage sample."
  };
  if (termsLinks[0]) {
    const termsFetch = await fetchSample(termsLinks[0], { accept: "text/html,text/plain,*/*" });
    terms = {
      decision: termsFetch.ok && scanTerms(termsFetch.text) ? "prohibited" : (termsFetch.ok ? "no_prohibition_detected_in_sample" : "unknown"),
      url: termsLinks[0],
      status: termsFetch.status,
      notes: termsFetch.ok ? "Sampled first terms/legal page." : (termsFetch.error || `${termsFetch.status} ${termsFetch.status_text}`)
    };
  }

  let feed = { ok: false, url: "", checked: [] };
  for (const candidate of feedCandidatesFor(source)) {
    const result = await fetchSample(candidate, { accept: "application/rss+xml,application/atom+xml,application/xml,text/xml,*/*" });
    feed.checked.push({
      url: candidate,
      status: result.status,
      ok: looksLikeFeed(result),
      item_count: countFeedItems(result),
      content_type: result.content_type,
      error: result.error || ""
    });
    if (looksLikeFeed(result)) {
      feed.ok = true;
      feed.url = candidate;
      break;
    }
  }

  return {
    id: source.id,
    name: source.name,
    source_type: source.source_type,
    method: source.method,
    enabled: source.enabled,
    url: source.url,
    linked_topics: linkedTopics,
    robots,
    homepage: {
      ok: homepage.ok,
      status: homepage.status,
      final_url: homepage.final_url,
      content_type: homepage.content_type,
      error: homepage.error || ""
    },
    feed: { ok: feed.ok, url: feed.url, checked_count: feed.checked.length, checked: feed.checked },
    terms,
    recommendation: recommendation(source, robots, feed.ok, terms)
  };
}

function renderMarkdown(results, now) {
  const enabled = results.filter((item) => item.enabled);
  const byRecommendation = {};
  for (const item of enabled) byRecommendation[item.recommendation] = (byRecommendation[item.recommendation] || 0) + 1;

  const lines = [
    "# Enabled Source Verification",
    "",
    `Generated at: ${now.toISOString()}`,
    "",
    `- enabled_sources_checked: ${enabled.length}`,
    `- recommendations: ${JSON.stringify(byRecommendation)}`,
    "",
    "| id | type | method | topics | robots | homepage | feed | terms | recommendation |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |"
  ];

  for (const item of enabled) {
    lines.push([
      item.id,
      item.source_type || "",
      item.method || "",
      item.linked_topics.join(", "),
      `${item.robots.decision}${item.robots.status ? ` (${item.robots.status})` : ""}`,
      `${item.homepage.ok ? "ok" : "fail"}${item.homepage.status ? ` (${item.homepage.status})` : ""}`,
      item.feed.ok ? `ok: ${item.feed.url}` : "none",
      `${item.terms.decision}${item.terms.status ? ` (${item.terms.status})` : ""}`,
      item.recommendation
    ].map((value) => String(value).replace(/\|/g, "\\|")).join(" | ").replace(/^/, "| ").replace(/$/, " |"));
  }

  lines.push("", "## Feed Candidates Found", "");
  for (const item of enabled.filter((entry) => entry.feed.ok)) {
    lines.push(`- ${item.id}: ${item.feed.url}`);
  }
  if (!enabled.some((entry) => entry.feed.ok)) lines.push("- none");

  lines.push("", "## Keep Manual Check", "");
  for (const item of enabled.filter((entry) => entry.recommendation === "keep_manual_check")) {
    lines.push(`- ${item.id}: robots=${item.robots.decision}, homepage=${item.homepage.status || "n/a"}, terms=${item.terms.decision}`);
  }

  return `${lines.join("\n")}\n`;
}

async function main() {
  const root = process.cwd();
  const now = new Date();
  const sources = JSON.parse(await readFile(join(root, "config", "sources.json"), "utf8"));
  const topics = JSON.parse(await readFile(join(root, "config", "watch_topics.json"), "utf8"));
  const enabledSources = sources.filter((source) => source.enabled);
  const results = [];

  for (const source of enabledSources) {
    console.log(`verifying ${source.id}`);
    results.push(await verifySource(source, topics));
  }

  await mkdir(join(root, "outputs", "raw"), { recursive: true });
  await mkdir(join(root, "outputs", "reports"), { recursive: true });
  const stamp = timestamp();
  const rawPath = join(root, "outputs", "raw", `enabled-source-verification-${stamp}.json`);
  const reportPath = join(root, "outputs", "reports", `enabled-source-verification-${stamp}.md`);
  await writeFile(rawPath, JSON.stringify(results, null, 2), "utf8");
  await writeFile(reportPath, renderMarkdown(results, now), "utf8");
  console.log(`Wrote ${rawPath}`);
  console.log(`Wrote ${reportPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
