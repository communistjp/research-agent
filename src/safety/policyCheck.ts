const forbiddenBrowserPurposes = new Set([
  "form_submission",
  "email_send",
  "social_post",
  "comment_post",
  "purchase",
  "reservation",
  "application",
  "registration",
  "delete",
  "settings_change",
  "account_change",
  "password_entry",
  "payment_entry",
  "captcha_or_bot_detection_bypass",
  "access_control_bypass",
  "bulk_browser_collection_as_paid_api_substitute",
  "bulk_paywalled_text_storage",
  "external_transmission_of_personal_or_non_public_information"
]);

const validRetrievalMethods = new Set([
  "api",
  "rss",
  "official_csv",
  "official_pdf",
  "public_html",
  "search",
  "playwright",
  "chrome_extension",
  "manual_check"
]);

const validAccessScopes = new Set([
  "public",
  "login_required",
  "paid_access",
  "internal",
  "unknown"
]);

export function assertSourcePolicy(source) {
  if (!source.enabled) return;
  if (!source.id || !source.name || !source.url) {
    throw new Error(`Source is missing required id/name/url: ${JSON.stringify(source)}`);
  }
  if (!validRetrievalMethods.has(source.method)) {
    throw new Error(`Source ${source.id} has unsupported method: ${source.method}`);
  }
  if (!validAccessScopes.has(source.access_scope)) {
    throw new Error(`Source ${source.id} has unsupported access_scope: ${source.access_scope}`);
  }
  if (source.access_scope === "internal") {
    throw new Error(`Source ${source.id} is internal; this agent only stores public or minimal authorized metadata.`);
  }
}

export function assertBrowserPurposeAllowed(purpose) {
  if (forbiddenBrowserPurposes.has(purpose)) {
    throw new Error(`Browser purpose is forbidden by policy: ${purpose}`);
  }
}

export function normalizeAccessScope(value) {
  return validAccessScopes.has(value) ? value : "unknown";
}
