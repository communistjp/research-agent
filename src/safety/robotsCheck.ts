function isNetworkUrl(url) {
  return /^https?:\/\//i.test(url);
}

function robotsUrlFor(url) {
  const parsed = new URL(url);
  return `${parsed.origin}/robots.txt`;
}

function parseRobots(text, userAgent = "research-agent") {
  const lines = text.split(/\r?\n/);
  const groups = [];
  let current = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*/, "").trim();
    if (!line) continue;
    const [rawKey, ...rawValue] = line.split(":");
    const key = rawKey.toLowerCase().trim();
    const value = rawValue.join(":").trim();

    if (key === "user-agent") {
      current = { agents: [value.toLowerCase()], rules: [] };
      groups.push(current);
    } else if ((key === "allow" || key === "disallow") && current) {
      current.rules.push({ type: key, path: value });
    }
  }

  const agent = userAgent.toLowerCase();
  return groups.filter((group) => {
    return group.agents.some((candidate) => candidate === "*" || agent.includes(candidate));
  }).flatMap((group) => group.rules);
}

export async function checkRobotsAllowed(url, userAgent = "research-agent") {
  if (!isNetworkUrl(url)) {
    return { allowed: true, checked: false, notes: ["robots.txt skipped for non-network URL."] };
  }

  const parsed = new URL(url);
  const response = await fetch(robotsUrlFor(url), {
    headers: { "user-agent": `${userAgent}/0.1` }
  });

  if (response.status === 404) {
    return { allowed: true, checked: true, notes: ["robots.txt not found; direct configured URL was not blocked."] };
  }
  if (!response.ok) {
    return { allowed: true, checked: false, notes: [`robots.txt could not be checked: ${response.status} ${response.statusText}.`] };
  }

  const rules = parseRobots(await response.text(), userAgent);
  const path = `${parsed.pathname}${parsed.search}`;
  const matching = rules
    .filter((rule) => rule.path && path.startsWith(rule.path))
    .sort((a, b) => b.path.length - a.path.length);

  if (matching[0]?.type === "disallow") {
    return { allowed: false, checked: true, notes: [`robots.txt disallows ${path} for ${userAgent}.`] };
  }

  return { allowed: true, checked: true, notes: ["robots.txt checked; configured URL is not disallowed."] };
}
