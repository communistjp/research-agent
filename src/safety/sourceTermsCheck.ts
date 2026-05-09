function scanTerms(text) {
  const lower = text.toLowerCase();
  const prohibitedPatterns = [
    /automated (collection|access|scraping).{0,80}(prohibited|forbidden|not allowed)/,
    /(scraping|crawling|robots|bots).{0,80}(prohibited|forbidden|not allowed)/,
    /(do not|may not).{0,80}(scrape|crawl|use bots|automated)/
  ];

  return prohibitedPatterns.some((pattern) => pattern.test(lower));
}

export async function checkSourceTerms(source) {
  if (source.terms_status === "prohibited") {
    return { allowed: false, checked: true, notes: ["Source terms are configured as prohibited."] };
  }
  if (source.terms_status === "allowed" && !source.terms_url) {
    return { allowed: true, checked: true, notes: ["Source terms are configured as allowed."] };
  }
  if (!source.terms_url) {
    return { allowed: true, checked: false, notes: ["No source terms URL configured; collection remains limited to configured public endpoints."] };
  }

  const response = await fetch(source.terms_url, {
    headers: { "user-agent": "research-agent/0.1 source terms checker" }
  });
  if (!response.ok) {
    return { allowed: true, checked: false, notes: [`Source terms could not be checked: ${response.status} ${response.statusText}.`] };
  }

  const text = (await response.text()).slice(0, 20000);
  if (scanTerms(text)) {
    return { allowed: false, checked: true, notes: ["Source terms appear to prohibit automated collection."] };
  }

  return { allowed: true, checked: true, notes: ["Source terms checked; no automated-collection prohibition detected in the sampled text."] };
}
