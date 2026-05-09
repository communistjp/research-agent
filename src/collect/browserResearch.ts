import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assertBrowserPurposeAllowed } from "../safety/policyCheck.ts";

const allowedVerificationPurposes = new Set([
  "open_page",
  "search",
  "follow_links",
  "open_pdf",
  "read_public_or_authorized_page",
  "record_url_title_published_at_fetched_at_source",
  "small_scale_screenshot_for_verification",
  "verify_api_or_html_result_on_original_page"
]);

export function makeBrowserVerificationTask(source, topic, reason, now = new Date()) {
  const purpose = "verify_api_or_html_result_on_original_page";
  assertBrowserPurposeAllowed(purpose);

  if (!allowedVerificationPurposes.has(purpose)) {
    throw new Error(`Browser verification purpose is not allowlisted: ${purpose}`);
  }

  return {
    topic: topic.name,
    source_id: source.id,
    source_name: source.name,
    url: source.url,
    created_at: now.toISOString(),
    status: "pending_manual_review",
    retrieval_method_when_done: "chrome_extension",
    access_scope: source.access_scope || "unknown",
    purpose,
    reason,
    limits: {
      max_pages: 3,
      no_form_submission: true,
      no_login_bypass: true,
      no_paywall_storage: true,
      no_captcha_or_bot_bypass: true,
      no_bulk_collection: true
    },
    allowed_actions: [
      "open the original page",
      "verify URL/title/published date/source name",
      "inspect a small amount of visible text",
      "save a screenshot only when needed for verification"
    ],
    forbidden_actions: [
      "submit forms",
      "post or send messages",
      "purchase, reserve, register, delete, or change settings",
      "enter passwords or payment information",
      "bypass CAPTCHA, paywalls, bot detection, rate limits, or access controls",
      "bulk collect paywalled or login-only text"
    ]
  };
}

export async function writeBrowserTasks(root, tasks, topicId) {
  if (tasks.length === 0) return null;
  const dir = join(root, "outputs", "browser_tasks");
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${topicId}.json`);
  await writeFile(path, JSON.stringify(tasks, null, 2), "utf8");
  return path;
}
