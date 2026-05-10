import { dirname, join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";

const DEFAULT_INPUT = "C:\\Users\\darda\\OneDrive\\デスクトップ\\following.js";
const PROFILE_RESOLUTION_NOTE = "The archive provides numeric account IDs and intent-user links, but not handles, display names, bios, or external profile URLs. A direct HTTP fetch of intent/user returns the X app shell rather than profile data; resolve selected accounts through an official API or small manual browser review before enabling them.";

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
    .replace(/^\s*window\.YTD\.following\.part0\s*=\s*/, "")
    .replace(/;\s*$/, "")
    .trim();
}

function slugify(input) {
  return String(input || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function makeCandidate(following) {
  const accountId = String(following.accountId || "").trim();
  const userLink = String(following.userLink || `https://twitter.com/intent/user?user_id=${accountId}`);
  return {
    id: `following-x-${slugify(accountId)}`,
    name: `X account ${accountId}`,
    source_type: "social_media",
    url: userLink,
    terms_status: "unknown",
    method: "manual_check",
    access_scope: "public",
    enabled: false,
    profile_resolution: {
      status: "manual_check_required",
      method: "official_api_or_manual_browser_review",
      note: PROFILE_RESOLUTION_NOTE
    },
    derived_from: {
      input: "x_following_archive",
      account_id: accountId,
      note: "Generated from X/Twitter following archive. Resolve account identity and review terms before enabling or using as a research source."
    }
  };
}

function renderReport({ input, total, candidates }) {
  const rows = candidates.slice(0, 80).map((source, index) => {
    return `| ${index + 1} | ${source.derived_from.account_id} | ${source.url} |`;
  }).join("\n");

  return `# Following Source Extraction

- input: ${input}
- followed_accounts: ${total}
- candidate_sources: ${candidates.length}

This archive file only contains X/Twitter numeric account IDs and intent-user links. It does not include handles, display names, bios, profile URLs outside X, or post text. The generated source records are therefore disabled manual-check candidates.

## Profile resolution status

${PROFILE_RESOLUTION_NOTE}

Do not enable these candidates in research-agent until the account identity, terms status, source quality, and intended collection method have been reviewed.

| rank | account_id | url |
| ---: | --- | --- |
${rows}
`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = process.cwd();
  const input = args.input || join(homedir(), "OneDrive", "\u30c7\u30b9\u30af\u30c8\u30c3\u30d7", "following.js");
  const output = args.output || join(root, "config", "following_source_candidates.json");
  const rawOutput = args.rawOutput || join(root, "outputs", "raw", "following_sources.json");
  const reportOutput = args.report || join(root, "outputs", "reports", "following-source-extraction-20260510.md");

  const raw = await readFile(input, "utf8");
  const items = JSON.parse(stripArchiveAssignment(raw));
  const seen = new Set();
  const rawRecords = [];
  const candidates = [];

  for (const item of items) {
    const following = item.following || {};
    const accountId = String(following.accountId || "").trim();
    if (!accountId || seen.has(accountId)) continue;
    seen.add(accountId);
    rawRecords.push(following);
    candidates.push(makeCandidate(following));
  }

  await mkdir(dirname(output), { recursive: true });
  await mkdir(dirname(rawOutput), { recursive: true });
  await mkdir(dirname(reportOutput), { recursive: true });
  await writeFile(output, JSON.stringify(candidates, null, 2) + "\n", "utf8");
  await writeFile(rawOutput, JSON.stringify(rawRecords, null, 2) + "\n", "utf8");
  await writeFile(reportOutput, renderReport({
    input,
    total: items.length,
    candidates
  }), "utf8");

  console.log(`followed_accounts=${items.length}`);
  console.log(`candidate_sources=${candidates.length}`);
  console.log(`wrote ${output}`);
  console.log(`wrote ${rawOutput}`);
  console.log(`wrote ${reportOutput}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
