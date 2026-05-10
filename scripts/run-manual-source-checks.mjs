import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const USER_AGENT = "research-agent/0.1 manual-source-check";
const TIMEOUT_MS = 15000;
const MAX_TEXT = 50000;
const MAX_EXAMPLES = 3;

function timestamp() {
  return new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
}

function originOf(url) {
  try {
    return new URL(url).origin;
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
      headers: {
        "user-agent": USER_AGENT,
        accept: options.accept || "text/html,application/xhtml+xml,application/xml,text/xml,*/*"
      },
      signal: AbortSignal.timeout(options.timeoutMs || TIMEOUT_MS)
    });
    const contentType = response.headers.get("content-type") || "";
    const text = options.noBody ? "" : (await response.text()).slice(0, MAX_TEXT);
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
    disallow_all: disallowAll && !allowRoot,
    matching_rules: rules.length
  };
}

function stripHtml(text) {
  return String(text || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleFromHtml(html) {
  const match = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? stripHtml(match[1]).slice(0, 160) : "";
}

function attrValue(tag, attrName) {
  const pattern = new RegExp(`${attrName}\\s*=\\s*["']([^"']*)["']`, "i");
  return tag.match(pattern)?.[1] || "";
}

function extractLinks(html, baseUrl) {
  const links = [];
  for (const match of String(html || "").matchAll(/<(a|link)\b[^>]*>/gi)) {
    const tag = match[0];
    const href = attrValue(tag, "href");
    if (!href) continue;
    try {
      links.push({
        url: new URL(href, baseUrl).toString(),
        rel: attrValue(tag, "rel").toLowerCase(),
        type: attrValue(tag, "type").toLowerCase(),
        title: attrValue(tag, "title")
      });
    } catch {
      // Ignore malformed links.
    }
  }
  return links;
}

function discoverFeedLinks(homepage, baseUrl) {
  const links = extractLinks(homepage.text, baseUrl);
  const candidates = links
    .filter((link) => (
      link.type.includes("rss") ||
      link.type.includes("atom") ||
      /(^|\/)(rss|feed|atom)(\/|\.|$)/i.test(new URL(link.url).pathname)
    ))
    .map((link) => link.url);
  return uniq(candidates).slice(0, 8);
}

function discoverTermsLinks(homepage, baseUrl) {
  const links = extractLinks(homepage.text, baseUrl);
  return uniq(links
    .filter((link) => {
      const haystack = `${link.url} ${link.rel} ${link.title}`.toLowerCase();
      return /(terms|termsofuse|terms-of-use|user-agreement|legal|policy|利用規約|サイトポリシー|規約)/i.test(haystack);
    })
    .map((link) => link.url)).slice(0, 5);
}

function looksLikeFeed(result) {
  const contentType = result.content_type.toLowerCase();
  const text = result.text.slice(0, 2000).toLowerCase();
  return result.ok && (
    contentType.includes("rss") ||
    contentType.includes("atom") ||
    text.includes("<rss") ||
    text.includes("<feed") ||
    text.includes("<rdf:rdf")
  );
}

function scanTerms(text) {
  const lower = String(text || "").toLowerCase();
  const prohibitedPatterns = [
    /automated (collection|access|scraping).{0,120}(prohibited|forbidden|not allowed)/,
    /(scraping|crawling|robots|bots).{0,120}(prohibited|forbidden|not allowed)/,
    /(do not|may not).{0,120}(scrape|crawl|use bots|automated)/,
    /without (our )?prior written consent.{0,160}(scrape|crawl|bot|automated)/,
    /(スクレイピング|クローリング|ロボット).{0,100}(禁止|お断り|許可なく|無断)/
  ];
  return prohibitedPatterns.some((pattern) => pattern.test(lower));
}

function publicHtmlCandidate(homepage, examples, robotsDecision, termsDecision) {
  if (robotsDecision === "blocked" || termsDecision === "prohibited") return false;
  if (homepage.ok && homepage.content_type.toLowerCase().includes("html")) return true;
  return examples.some((example) => example.ok && example.content_type.toLowerCase().includes("html"));
}

function decide(result) {
  if (result.robots.decision === "blocked") return "blocked_by_robots";
  if (result.terms.decision === "prohibited") return "blocked_by_terms";
  if (result.feed.ok) return "rss_candidate";
  if (result.homepage.status === 401 || result.homepage.status === 403) return "keep_manual_access_limited";
  if (publicHtmlCandidate(result.homepage, result.examples, result.robots.decision, result.terms.decision)) {
    if (result.terms.decision === "not_found" || result.terms.decision === "unknown") return "public_html_candidate_terms_unresolved";
    return "public_html_candidate";
  }
  return "keep_manual_no_usable_endpoint";
}

async function checkSource(source, topics) {
  const origin = originOf(source.url);
  const linkedTopics = topics.filter((topic) => (topic.source_ids || []).includes(source.id)).map((topic) => topic.id);
  const robotsUrl = origin ? `${origin}/robots.txt` : "";
  const robotsFetch = robotsUrl ? await fetchSample(robotsUrl, { accept: "text/plain,*/*" }) : { ok: false, status: null, error: "invalid origin", text: "" };
  const robotsParsed = robotsFetch.ok ? parseRobots(robotsFetch.text) : { disallow_all: false, matching_rules: 0 };
  const robots = {
    url: robotsUrl,
    decision: robotsParsed.disallow_all ? "blocked" : (robotsFetch.ok ? "not_blocked_by_sample" : "unknown"),
    status: robotsFetch.status,
    matching_rules: robotsParsed.matching_rules,
    error: robotsFetch.error || ""
  };

  const homepage = await fetchSample(source.url);
  const feedLinks = homepage.ok ? discoverFeedLinks(homepage, source.url) : [];
  const feedChecks = [];
  for (const url of feedLinks) {
    const checked = await fetchSample(url, { accept: "application/rss+xml,application/atom+xml,application/xml,text/xml,*/*" });
    feedChecks.push({
      url,
      ok: looksLikeFeed(checked),
      status: checked.status,
      content_type: checked.content_type,
      error: checked.error || ""
    });
  }
  const feed = feedChecks.find((item) => item.ok) || null;

  const termsLinks = homepage.ok ? discoverTermsLinks(homepage, source.url) : [];
  let terms = {
    decision: termsLinks.length > 0 ? "link_found_unchecked" : "not_found",
    url: termsLinks[0] || "",
    status: null,
    error: ""
  };
  if (termsLinks[0]) {
    const termsFetch = await fetchSample(termsLinks[0]);
    terms = {
      decision: termsFetch.ok && scanTerms(termsFetch.text) ? "prohibited" : (termsFetch.ok ? "no_prohibition_detected_in_sample" : "unknown"),
      url: termsLinks[0],
      status: termsFetch.status,
      error: termsFetch.error || ""
    };
  }

  const examples = [];
  for (const url of (source.example_urls || []).slice(0, MAX_EXAMPLES)) {
    const checked = await fetchSample(url);
    examples.push({
      url,
      ok: checked.ok,
      status: checked.status,
      final_url: checked.final_url,
      content_type: checked.content_type,
      title: titleFromHtml(checked.text),
      error: checked.error || ""
    });
  }

  const result = {
    id: source.id,
    name: source.name,
    source_type: source.source_type,
    url: source.url,
    method: source.method,
    linked_topics: linkedTopics,
    robots,
    homepage: {
      ok: homepage.ok,
      status: homepage.status,
      final_url: homepage.final_url,
      content_type: homepage.content_type,
      title: titleFromHtml(homepage.text),
      error: homepage.error || ""
    },
    feed: {
      ok: Boolean(feed),
      url: feed?.url || "",
      checked: feedChecks
    },
    terms,
    examples
  };
  result.decision = decide(result);
  return result;
}

function renderMarkdown(results, now) {
  const byDecision = {};
  for (const result of results) byDecision[result.decision] = (byDecision[result.decision] || 0) + 1;

  const lines = [
    "# Manual Source Check",
    "",
    `Generated at: ${now.toISOString()}`,
    "",
    `- manual_sources_checked: ${results.length}`,
    `- decisions: ${JSON.stringify(byDecision)}`,
    "",
    "| id | homepage | robots | terms | feed | examples_ok | decision |",
    "| --- | --- | --- | --- | --- | ---: | --- |"
  ];

  for (const result of results) {
    const examplesOk = result.examples.filter((example) => example.ok).length;
    lines.push([
      result.id,
      `${result.homepage.status || "n/a"} ${result.homepage.ok ? "ok" : "fail"}`,
      `${result.robots.decision}${result.robots.status ? ` (${result.robots.status})` : ""}`,
      `${result.terms.decision}${result.terms.status ? ` (${result.terms.status})` : ""}`,
      result.feed.ok ? result.feed.url : "none",
      String(examplesOk),
      result.decision
    ].map((value) => String(value).replace(/\|/g, "\\|")).join(" | ").replace(/^/, "| ").replace(/$/, " |"));
  }

  lines.push("", "## RSS Candidates", "");
  for (const result of results.filter((item) => item.decision === "rss_candidate")) {
    lines.push(`- ${result.id}: ${result.feed.url}`);
  }
  if (!results.some((item) => item.decision === "rss_candidate")) lines.push("- none");

  lines.push("", "## Access Limited Or Blocked", "");
  for (const result of results.filter((item) => item.decision.includes("blocked") || item.decision === "keep_manual_access_limited")) {
    lines.push(`- ${result.id}: homepage=${result.homepage.status || "n/a"}, robots=${result.robots.decision}, terms=${result.terms.decision}`);
  }
  if (!results.some((item) => item.decision.includes("blocked") || item.decision === "keep_manual_access_limited")) lines.push("- none");

  return `${lines.join("\n")}\n`;
}

async function main() {
  const root = process.cwd();
  const now = new Date();
  const sourcesPath = join(root, "config", "sources.json");
  const sources = JSON.parse(await readFile(sourcesPath, "utf8"));
  const topics = JSON.parse(await readFile(join(root, "config", "watch_topics.json"), "utf8"));
  const manualSources = sources.filter((source) => source.enabled && source.method === "manual_check");
  const results = [];

  for (const source of manualSources) {
    console.log(`checking ${source.id}`);
    const result = await checkSource(source, topics);
    results.push(result);
    const original = sources.find((item) => item.id === source.id);
    original.manual_check_review = {
      reviewed_at: now.toISOString(),
      decision: result.decision,
      report_hint: "outputs/reports/manual-source-check-*.md",
      robots: result.robots,
      homepage: result.homepage,
      terms: result.terms,
      feed: {
        ok: result.feed.ok,
        url: result.feed.url
      },
      examples_checked: result.examples.map((example) => ({
        url: example.url,
        ok: example.ok,
        status: example.status,
        content_type: example.content_type,
        title: example.title
      }))
    };
  }

  await mkdir(join(root, "outputs", "raw"), { recursive: true });
  await mkdir(join(root, "outputs", "reports"), { recursive: true });
  const stamp = timestamp();
  const rawPath = join(root, "outputs", "raw", `manual-source-check-${stamp}.json`);
  const reportPath = join(root, "outputs", "reports", `manual-source-check-${stamp}.md`);
  await writeFile(rawPath, JSON.stringify(results, null, 2), "utf8");
  await writeFile(reportPath, renderMarkdown(results, now), "utf8");
  await writeFile(sourcesPath, `${JSON.stringify(sources, null, 2)}\n`, "utf8");
  console.log(`Wrote ${rawPath}`);
  console.log(`Wrote ${reportPath}`);
  console.log("Updated config/sources.json manual_check_review fields");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
