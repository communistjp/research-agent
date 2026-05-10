import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const DEFAULT_INPUT = "C:\\Users\\darda\\OneDrive\\デスクトップ\\like.js";
const EXCLUDED_HOSTS = new Set([
  "t.co",
  "twitter.com",
  "www.twitter.com",
  "x.com",
  "www.x.com",
  "mobile.twitter.com",
  "pbs.twimg.com",
  "video.twimg.com"
]);

const SUPPLEMENTAL_KEYWORDS = {
  "openai-news": [
    "AI",
    "OpenAI",
    "ChatGPT",
    "GPT",
    "API",
    "model",
    "LLM",
    "Anthropic",
    "Claude",
    "Gemini",
    "xAI",
    "Nvidia",
    "Microsoft",
    "Google",
    "Meta"
  ],
  "international-politics": [
    "Trump",
    "Iran",
    "Hormuz",
    "UAE",
    "Israel",
    "Gaza",
    "South Korea",
    "China",
    "Taiwan",
    "Russia",
    "Ukraine",
    "NATO",
    "military",
    "Navy",
    "missile",
    "security",
    "geopolitics",
    "foreign policy",
    "diplomacy",
    "war",
    "イラン",
    "ホルムズ",
    "トランプ",
    "台湾",
    "中国",
    "韓国"
  ],
  "global-economy": [
    "economy",
    "inflation",
    "trade",
    "tariff",
    "Fed",
    "BOJ",
    "rate",
    "yen",
    "dollar",
    "market",
    "stock",
    "金融",
    "経済",
    "金利",
    "貿易",
    "関税",
    "為替",
    "株"
  ],
  "ai-disability-welfare": [
    "disability",
    "welfare",
    "accessibility",
    "assistive technology",
    "care",
    "social work",
    "障害",
    "福祉",
    "アクセシビリティ",
    "支援技術",
    "介護",
    "相談"
  ],
  "interpersonal-support": [
    "interpersonal support",
    "care work",
    "social work",
    "counseling",
    "peer support",
    "対人支援",
    "相談支援",
    "ケア",
    "ソーシャルワーク"
  ]
};

const NEWS_HOST_PATTERNS = [
  "reuters.com",
  "apnews.com",
  "bloomberg.com",
  "ft.com",
  "wsj.com",
  "nytimes.com",
  "washingtonpost.com",
  "bbc.com",
  "cnn.com",
  "theguardian.com",
  "axios.com",
  "politico.com",
  "aljazeera.com",
  "timesofisrael.com",
  "japantimes.co.jp",
  "nikkei.com",
  "nhk.or.jp",
  "asahi.com",
  "yomiuri.co.jp",
  "mainichi.jp",
  "sankei.com",
  "jiji.com",
  "kyodonews.net",
  "47news.jp",
  "news.yahoo.co.jp",
  "bloomberg.co.jp",
  "news.web.nhk",
  "fukushishimbun.com",
  "fukushishimbun.co.jp",
  "zakzak.co.jp",
  "toyokeizai.net",
  "gendai.media",
  "nordot.app",
  "fnn.jp",
  "newsmax.com",
  "itmedia.co.jp",
  "news.livedoor.com",
  "newsdig.tbs.co.jp",
  "newsweekjapan.jp",
  "tokyo-np.co.jp",
  "ascii.jp"
];

const THINK_TANK_HOST_PATTERNS = [
  "csis.org",
  "brookings.edu",
  "carnegieendowment.org",
  "fdd.org",
  "atlanticcouncil.org",
  "rand.org",
  "warontherocks.com",
  "iiss.org",
  "rusi.org",
  "cfr.org"
];

const COMPANY_HOST_PATTERNS = [
  "openai.com",
  "anthropic.com",
  "google.com",
  "blog.google",
  "googleblog.com",
  "microsoft.com",
  "nvidia.com",
  "x.ai",
  "chatgpt.com",
  "meta.com",
  "apple.com",
  "amazon.com"
];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function stripArchiveAssignment(raw) {
  return raw
    .replace(/^\s*window\.YTD\.like\.part0\s*=\s*/, "")
    .replace(/;\s*$/, "")
    .trim();
}

function extractUrls(text) {
  return [...String(text || "").matchAll(/https?:\/\/[^\s"<>]+/g)]
    .map((match) => match[0].replace(/[.,)\]}>"'、。]+$/g, ""));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function makeTopicMatchers(topics) {
  return topics.map((topic) => {
    const keywords = [
      ...(topic.keywords || []),
      ...(SUPPLEMENTAL_KEYWORDS[topic.id] || [])
    ].filter(Boolean);
    const regexes = keywords.map((keyword) => new RegExp(escapeRegExp(keyword), "i"));
    return { topic, regexes };
  });
}

function topicIdsFor(text, matchers) {
  return matchers
    .filter(({ regexes }) => regexes.some((regex) => regex.test(text)))
    .map(({ topic }) => topic.id);
}

function isTco(url) {
  try {
    return new URL(url).hostname.toLowerCase() === "t.co";
  } catch {
    return false;
  }
}

function hostname(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function originForHost(host) {
  return `https://${host}/`;
}

function slugify(input) {
  return String(input || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function sourceNameFromHost(host) {
  return host
    .replace(/^www\./, "")
    .split(".")
    .filter(Boolean)
    .map((part) => part === "ai" ? "AI" : part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function hostMatches(host, patterns) {
  return patterns.some((pattern) => host === pattern || host.endsWith(`.${pattern}`));
}

function classifySourceType(host) {
  if (host.endsWith(".go.jp") || host.endsWith(".gov") || host.endsWith(".mil")) return "official_government";
  if (host.endsWith(".lg.jp")) return "official_local_government";
  if (host === "boj.or.jp") return "official_government";
  if (host.endsWith(".edu") || host === "arxiv.org" || hostMatches(host, ["nature.com", "science.org"])) return "academic";
  if (hostMatches(host, THINK_TANK_HOST_PATTERNS)) return "think_tank";
  if (hostMatches(host, NEWS_HOST_PATTERNS)) return "news_media";
  if (hostMatches(host, COMPANY_HOST_PATTERNS)) return "official_company";
  if (hostMatches(host, ["youtube.com", "youtu.be", "substack.com", "medium.com", "note.com"])) return "blog";
  return "unknown";
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function loadTcoCache(path) {
  return await readJson(path, {});
}

async function saveTcoCache(path, cache) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(cache, null, 2) + "\n", "utf8");
}

async function resolveOnce(url, method) {
  const response = await fetch(url, {
    method,
    redirect: "manual",
    headers: {
      "user-agent": "Mozilla/5.0 research-agent-source-extractor/0.1",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  });
  return {
    status: response.status,
    location: response.headers.get("location") || "",
    contentType: response.headers.get("content-type") || ""
  };
}

async function resolveTcoUrl(url) {
  try {
    let current = url;
    for (let step = 0; step < 8; step += 1) {
      let result = await resolveOnce(current, "HEAD");
      if (!result.location && (result.status === 405 || result.status === 403 || result.status === 400)) {
        result = await resolveOnce(current, "GET");
      }
      if (result.location) {
        const next = new URL(result.location, current).toString();
        if (next === current) {
          return { ok: true, original_url: url, final_url: next, status: result.status, resolver_version: 2 };
        }
        current = next;
        continue;
      }

      const ok = result.status >= 200 && result.status < 400;
      return {
        ok,
        original_url: url,
        final_url: current,
        status: result.status,
        resolver_version: 2,
        ...(ok ? {} : { error: "no_redirect_location" })
      };
    }
    return { ok: false, original_url: url, final_url: current, error: "redirect_limit", resolver_version: 2 };
  } catch (error) {
    return { ok: false, original_url: url, final_url: "", error: error.message, resolver_version: 2 };
  }
}

async function mapWithConcurrency(items, concurrency, task) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await task(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function shortText(text) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, 240);
}

function addSample(list, value, limit) {
  if (!value) return;
  const key = typeof value === "string" ? value : JSON.stringify(value);
  if (list.some((item) => (typeof item === "string" ? item : JSON.stringify(item)) === key)) return;
  if (list.length < limit) list.push(value);
}

function buildSourceCandidates(linkRecords) {
  const groups = new Map();
  for (const record of linkRecords) {
    if (!record.final_url) continue;
    const host = hostname(record.final_url);
    if (!host || EXCLUDED_HOSTS.has(host)) continue;
    if (!groups.has(host)) {
      groups.set(host, {
        host,
        count: 0,
        topic_ids: new Set(),
        example_urls: [],
        example_tweets: []
      });
    }
    const group = groups.get(host);
    group.count += 1;
    for (const topicId of record.topic_ids) group.topic_ids.add(topicId);
    addSample(group.example_urls, record.final_url, 10);
    addSample(group.example_tweets, {
      tweet_id: record.tweet_id,
      tweet_url: record.tweet_url,
      text: record.text
    }, 5);
  }

  return [...groups.values()]
    .map((group) => {
      const topicIds = [...group.topic_ids].sort();
      const sourceType = classifySourceType(group.host);
      return {
        id: `likes-${slugify(group.host)}`,
        name: sourceNameFromHost(group.host),
        source_type: sourceType,
        url: originForHost(group.host),
        terms_status: "unknown",
        method: "manual_check",
        access_scope: "public",
        enabled: false,
        derived_from: {
          input: "x_likes_archive",
          observed_count: group.count,
          topic_ids: topicIds,
          note: "Generated from liked X/Twitter posts. Review terms, robots, and canonical feed/API endpoints before enabling."
        },
        example_urls: group.example_urls,
        example_tweets: group.example_tweets
      };
    })
    .sort((a, b) => b.derived_from.observed_count - a.derived_from.observed_count || a.id.localeCompare(b.id));
}

function renderReport({
  input,
  totalLikes,
  selectedLikes,
  rawTcoCount,
  resolvedExternalCount,
  resolvedExcludedCount,
  unresolvedCount,
  candidates
}) {
  const topRows = candidates.slice(0, 50).map((source, index) => {
    const topics = source.derived_from.topic_ids.join(", ") || "none";
    return `| ${index + 1} | ${source.name} | ${source.source_type} | ${source.derived_from.observed_count} | ${topics} | ${source.url} |`;
  }).join("\n");
  return `# Like Source Extraction

- input: ${input}
- total_likes: ${totalLikes}
- selected_topic_matched_likes: ${selectedLikes}
- tco_links_seen_in_selected_likes: ${rawTcoCount}
- resolved_external_links: ${resolvedExternalCount}
- resolved_excluded_x_links: ${resolvedExcludedCount}
- unresolved_links: ${unresolvedCount}
- candidate_sources: ${candidates.length}

The generated source records are disabled by default. Treat them as research-agent candidates: review terms, robots.txt, feed/API availability, and source quality before enabling. The excluded count is mostly X/Twitter links that are useful as context but are not promoted into external research sources.

| rank | source | type | observations | topics | url |
| ---: | --- | --- | ---: | --- | --- |
${topRows}
`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = process.cwd();
  const input = args.input || join(homedir(), "OneDrive", "\u30c7\u30b9\u30af\u30c8\u30c3\u30d7", "like.js");
  const output = args.output || join(root, "config", "like_source_candidates.json");
  const rawOutput = args.rawOutput || join(root, "outputs", "raw", "like_source_links.json");
  const reportOutput = args.report || join(root, "outputs", "reports", "like-source-extraction-20260510.md");
  const cachePath = args.cache || join(root, "outputs", "cache", "tco-resolution-cache.json");
  const resolveLinks = Boolean(args.resolve);
  const refresh = Boolean(args.refresh);
  const includeAll = Boolean(args.all);
  const concurrency = Number(args.concurrency || 4);

  const topics = await readJson(join(root, "config", "watch_topics.json"), []);
  const matchers = makeTopicMatchers(topics);
  const raw = await readFile(input, "utf8");
  const likes = JSON.parse(stripArchiveAssignment(raw));
  const selectedLikes = [];
  const linkRecords = [];

  for (const item of likes) {
    const like = item.like || {};
    const text = String(like.fullText || "");
    const topicIds = topicIdsFor(text, matchers);
    if (!includeAll && topicIds.length === 0) continue;
    selectedLikes.push(item);
    const tweetUrl = like.expandedUrl || `https://twitter.com/i/web/status/${like.tweetId}`;
    for (const url of extractUrls(text)) {
      if (!isTco(url)) continue;
      linkRecords.push({
        tweet_id: like.tweetId,
        tweet_url: tweetUrl,
        text: shortText(text),
        topic_ids: topicIds,
        tco_url: url,
        final_url: "",
        resolution_ok: false,
        resolution_error: "not_resolved"
      });
    }
  }

  let cache = await loadTcoCache(cachePath);
  if (resolveLinks) {
    const uniqueTco = [...new Set(linkRecords.map((record) => record.tco_url))]
      .filter((url) => refresh || !cache[url] || cache[url].resolver_version !== 2);
    console.log(`Resolving ${uniqueTco.length} t.co URLs with concurrency=${concurrency}`);
    let completed = 0;
    await mapWithConcurrency(uniqueTco, concurrency, async (url) => {
      const result = await resolveTcoUrl(url);
      cache[url] = { ...result, resolved_at: new Date().toISOString() };
      completed += 1;
      if (completed % 100 === 0 || completed === uniqueTco.length) {
        console.log(`resolved ${completed}/${uniqueTco.length}`);
        await saveTcoCache(cachePath, cache);
      }
    });
    await saveTcoCache(cachePath, cache);
  }

  for (const record of linkRecords) {
    const cached = cache[record.tco_url];
    if (!cached) continue;
    record.final_url = cached.final_url || "";
    record.resolution_ok = Boolean(cached.ok);
    record.resolution_error = cached.ok ? "" : cached.error || "unknown";
    record.resolution_status = cached.status || null;
  }

  const candidates = buildSourceCandidates(linkRecords);
  const resolvedExternalCount = linkRecords.filter((record) => record.final_url && !EXCLUDED_HOSTS.has(hostname(record.final_url))).length;
  const resolvedExcludedCount = linkRecords.filter((record) => record.final_url && EXCLUDED_HOSTS.has(hostname(record.final_url))).length;
  const unresolvedCount = linkRecords.length - linkRecords.filter((record) => record.final_url).length;

  await mkdir(dirname(output), { recursive: true });
  await mkdir(dirname(rawOutput), { recursive: true });
  await mkdir(dirname(reportOutput), { recursive: true });
  await writeFile(output, JSON.stringify(candidates, null, 2) + "\n", "utf8");
  await writeFile(rawOutput, JSON.stringify(linkRecords, null, 2) + "\n", "utf8");
  await writeFile(reportOutput, renderReport({
    input,
    totalLikes: likes.length,
    selectedLikes: selectedLikes.length,
    rawTcoCount: linkRecords.length,
    resolvedExternalCount,
    resolvedExcludedCount,
    unresolvedCount,
    candidates
  }), "utf8");

  console.log(`likes=${likes.length}`);
  console.log(`selected_likes=${selectedLikes.length}`);
  console.log(`tco_links=${linkRecords.length}`);
  console.log(`candidate_sources=${candidates.length}`);
  console.log(`wrote ${output}`);
  console.log(`wrote ${rawOutput}`);
  console.log(`wrote ${reportOutput}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
