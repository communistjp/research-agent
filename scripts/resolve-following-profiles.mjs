import { dirname, join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const DEFAULT_INPUT = join(process.cwd(), "config", "following_source_candidates.json");
const DEFAULT_OUTPUT = join(process.cwd(), "outputs", "raw", "following_profile_resolution.json");
const DEFAULT_REPORT = join(process.cwd(), "outputs", "reports", "following-profile-resolution-20260510.md");
const DEFAULT_REVIEW_HTML = join(process.cwd(), "outputs", "reports", "following-profile-review-20260510.html");
const USER_AGENT = "research-agent-public-profile-resolver/0.1 (+manual-review; no private APIs)";
const SAFE_METHOD_NOTE = "Uses only ordinary public profile or intent-user page requests. It does not use cookies, private APIs, internal GraphQL endpoints, or access-control bypasses.";
const RESERVED_PATHS = new Set([
  "about",
  "compose",
  "explore",
  "hashtag",
  "home",
  "i",
  "intent",
  "login",
  "messages",
  "notifications",
  "privacy",
  "search",
  "settings",
  "share",
  "tos"
]);

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

function toInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeProfileUrl(url) {
  try {
    const parsed = new URL(url);
    if (!["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(parsed.hostname.toLowerCase())) {
      return null;
    }
    const firstPath = parsed.pathname.split("/").filter(Boolean)[0] || "";
    if (!/^[A-Za-z0-9_]{1,20}$/.test(firstPath)) return null;
    if (RESERVED_PATHS.has(firstPath.toLowerCase())) return null;
    return {
      handle: firstPath,
      profile_url: `https://x.com/${firstPath}`
    };
  } catch {
    return null;
  }
}

function htmlDecode(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function extractFromHtml(html) {
  const text = String(html || "");
  const urlPatterns = [
    /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i,
    /<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i,
    /https?:\\\/\\\/(?:www\\\.)?(?:x|twitter)\\\.com\\\/([A-Za-z0-9_]{1,20})(?:[\\\/?#"']|$)/i,
    /https?:\/\/(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,20})(?:[\/?#"']|$)/i
  ];

  for (const pattern of urlPatterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const raw = match[1]?.startsWith("http") ? htmlDecode(match[1]) : `https://x.com/${match[1]}`;
    const normalized = normalizeProfileUrl(raw);
    if (normalized) return normalized;
  }

  const screenName = text.match(/["']screen_name["']\s*:\s*["']([A-Za-z0-9_]{1,20})["']/i);
  if (screenName) {
    return {
      handle: screenName[1],
      profile_url: `https://x.com/${screenName[1]}`
    };
  }

  return null;
}

function classifyBlocked(status, body) {
  const text = String(body || "").slice(0, 5000).toLowerCase();
  if (status === 429) return "rate_limited";
  if (status === 403 && text.includes("cloudflare")) return "blocked_by_site";
  if (text.includes("sorry, you have been blocked")) return "blocked_by_site";
  if (text.includes("enable cookies")) return "cookie_or_browser_required";
  if (text.includes("log in to x") || text.includes("sign in to x")) return "login_required";
  return null;
}

async function fetchText(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "user-agent": USER_AGENT
      }
    });
    const text = await response.text().catch(() => "");
    return {
      final_url: response.url,
      ok: response.ok,
      status_code: response.status,
      text
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveCandidate(candidate, timeoutMs) {
  const checkedAt = new Date().toISOString();
  const accountId = candidate?.derived_from?.account_id || candidate?.id?.replace(/^following-x-/, "");
  const intentUrl = candidate?.derived_from?.intent_user_url || candidate?.url || `https://x.com/intent/user?user_id=${accountId}`;
  const requestUrl = intentUrl.replace("https://twitter.com/", "https://x.com/");

  try {
    const response = await fetchText(requestUrl, timeoutMs);
    const fromFinalUrl = normalizeProfileUrl(response.final_url);
    const fromHtml = fromFinalUrl || extractFromHtml(response.text);
    if (fromHtml) {
      return {
        account_id: accountId,
        checked_at: checkedAt,
        status: "resolved_public_profile_url",
        method: "public_intent_url_fetch",
        handle: fromHtml.handle,
        profile_url: fromHtml.profile_url,
        final_url: response.final_url,
        status_code: response.status_code,
        note: SAFE_METHOD_NOTE
      };
    }

    const blockedStatus = classifyBlocked(response.status_code, response.text);
    return {
      account_id: accountId,
      checked_at: checkedAt,
      status: blockedStatus || "public_resolution_unavailable",
      method: "public_intent_url_fetch",
      final_url: response.final_url,
      status_code: response.status_code,
      note: blockedStatus
        ? `${SAFE_METHOD_NOTE} Site response indicates ${blockedStatus}; leaving the candidate disabled for manual browser review.`
        : `${SAFE_METHOD_NOTE} No public profile URL or handle was visible in the response; leaving the candidate disabled for manual browser review.`
    };
  } catch (error) {
    return {
      account_id: accountId,
      checked_at: checkedAt,
      status: error?.name === "AbortError" ? "timeout" : "fetch_error",
      method: "public_intent_url_fetch",
      error: error?.message || String(error),
      note: `${SAFE_METHOD_NOTE} Resolution failed; leaving the candidate disabled for manual browser review.`
    };
  }
}

function mergeResolution(candidate, resolution) {
  const next = {
    ...candidate,
    profile_resolution: {
      ...(candidate.profile_resolution || {}),
      ...resolution
    },
    derived_from: {
      ...(candidate.derived_from || {}),
      intent_user_url: candidate.derived_from?.intent_user_url || candidate.url
    },
    enabled: false
  };

  if (resolution.status === "resolved_public_profile_url" && resolution.handle && resolution.profile_url) {
    next.name = `X @${resolution.handle}`;
    next.url = resolution.profile_url;
  }

  return next;
}

function renderReport({ input, results, total, start, limit, delayMs }) {
  const counts = results.reduce((acc, result) => {
    acc[result.status] = (acc[result.status] || 0) + 1;
    return acc;
  }, {});
  const countRows = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([status, count]) => `| ${status} | ${count} |`)
    .join("\n");
  const resultRows = results.map((result, index) => {
    const profile = result.profile_url || "";
    const handle = result.handle ? `@${result.handle}` : "";
    return `| ${start + index + 1} | ${result.account_id || ""} | ${result.status} | ${handle} | ${profile} | ${result.status_code || ""} |`;
  }).join("\n");

  return `# Following Profile Resolution

- input: ${input}
- total_candidates: ${total}
- checked_start_index: ${start}
- checked_limit: ${limit}
- checked_count: ${results.length}
- delay_ms: ${delayMs}

${SAFE_METHOD_NOTE}

All candidates remain disabled. Resolved profile URLs only improve reviewability; enabling a source still requires terms and source-quality review.

## Status Counts

| status | count |
| --- | ---: |
${countRows || "| none | 0 |"}

## Checked Accounts

| rank | account_id | status | handle | profile_url | status_code |
| ---: | --- | --- | --- | --- | ---: |
${resultRows}
`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderReviewHtml({ input, candidates }) {
  const rows = candidates.map((candidate, index) => {
    const accountId = candidate?.derived_from?.account_id || "";
    const intentUrl = candidate?.derived_from?.intent_user_url || candidate?.url || "";
    const profileUrl = candidate?.profile_resolution?.profile_url || "";
    const handle = candidate?.profile_resolution?.handle || "";
    const status = candidate?.profile_resolution?.status || "manual_check_required";
    const openUrl = profileUrl || intentUrl;
    return `<tr>
      <td>${index + 1}</td>
      <td><code>${escapeHtml(accountId)}</code></td>
      <td>${handle ? `<code>@${escapeHtml(handle)}</code>` : ""}</td>
      <td>${escapeHtml(status)}</td>
      <td><a href="${escapeHtml(openUrl)}" target="_blank" rel="noreferrer">open</a></td>
      <td><input aria-label="handle for ${escapeHtml(accountId)}" placeholder="@handle"></td>
      <td><input aria-label="display name for ${escapeHtml(accountId)}" placeholder="display name"></td>
      <td><input aria-label="notes for ${escapeHtml(accountId)}" placeholder="notes"></td>
    </tr>`;
  }).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Following Profile Review</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: Segoe UI, system-ui, sans-serif;
      line-height: 1.45;
    }
    body {
      margin: 24px;
      max-width: 1280px;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      font-size: 13px;
    }
    th, td {
      border-bottom: 1px solid #d0d7de;
      padding: 8px 10px;
      text-align: left;
      vertical-align: top;
    }
    th {
      position: sticky;
      top: 0;
      background: Canvas;
      z-index: 1;
    }
    input {
      box-sizing: border-box;
      width: 100%;
      min-width: 120px;
      padding: 6px 8px;
    }
    code {
      font-family: Consolas, monospace;
    }
  </style>
</head>
<body>
  <h1>Following Profile Review</h1>
  <p>Input: <code>${escapeHtml(input)}</code></p>
  <p>Open links in a logged-in browser, then copy confirmed handles or notes back into the candidate JSON. These rows remain disabled until terms and source quality are reviewed.</p>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>account_id</th>
        <th>handle</th>
        <th>status</th>
        <th>link</th>
        <th>confirmed handle</th>
        <th>display name</th>
        <th>notes</th>
      </tr>
    </thead>
    <tbody>
${rows}
    </tbody>
  </table>
</body>
</html>
`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const input = args.input || DEFAULT_INPUT;
  const output = args.output || DEFAULT_OUTPUT;
  const report = args.report || DEFAULT_REPORT;
  const reviewHtml = args.reviewHtml || DEFAULT_REVIEW_HTML;
  const start = toInt(args.start, 0);
  const limit = toInt(args.limit, 25);
  const delayMs = toInt(args["delay-ms"], 3000);
  const timeoutMs = toInt(args["timeout-ms"], 20000);
  const apply = Boolean(args.apply);

  const candidates = JSON.parse(await readFile(input, "utf8"));
  const skipFetch = Boolean(args["skip-fetch"]);
  const selected = skipFetch ? [] : candidates.slice(start, start + limit);
  const results = [];

  for (let index = 0; index < selected.length; index += 1) {
    const candidate = selected[index];
    const resolution = await resolveCandidate(candidate, timeoutMs);
    results.push(resolution);
    const marker = resolution.handle ? ` @${resolution.handle}` : "";
    console.log(`${start + index + 1}/${candidates.length} ${resolution.account_id}: ${resolution.status}${marker}`);
    if (index < selected.length - 1 && delayMs > 0) await delay(delayMs);
  }

  const payload = {
    generated_at: new Date().toISOString(),
    input,
    total_candidates: candidates.length,
    checked_start_index: start,
    checked_limit: limit,
    checked_count: results.length,
    delay_ms: delayMs,
    note: SAFE_METHOD_NOTE,
    results
  };

  await mkdir(dirname(output), { recursive: true });
  await mkdir(dirname(report), { recursive: true });
  await mkdir(dirname(reviewHtml), { recursive: true });
  await writeFile(output, JSON.stringify(payload, null, 2) + "\n", "utf8");
  await writeFile(report, renderReport({
    input,
    results,
    total: candidates.length,
    start,
    limit,
    delayMs
  }), "utf8");
  await writeFile(reviewHtml, renderReviewHtml({
    input,
    candidates
  }), "utf8");

  if (apply) {
    const resultByAccountId = new Map(results.map((result) => [String(result.account_id), result]));
    const merged = candidates.map((candidate) => {
      const accountId = String(candidate?.derived_from?.account_id || "");
      const resolution = resultByAccountId.get(accountId);
      return resolution ? mergeResolution(candidate, resolution) : candidate;
    });
    await writeFile(input, JSON.stringify(merged, null, 2) + "\n", "utf8");
    console.log(`updated ${input}`);
  }

  console.log(`wrote ${output}`);
  console.log(`wrote ${report}`);
  console.log(`wrote ${reviewHtml}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
