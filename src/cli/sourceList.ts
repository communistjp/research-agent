import { readJsonConfig } from "../config/configIo.ts";

async function main() {
  const root = process.cwd();
  const topics = await readJsonConfig(root, "watch_topics.json", []);
  const sources = await readJsonConfig(root, "sources.json", []);

  for (const topic of topics) {
    console.log(`\n[${topic.enabled ? "on" : "off"}] ${topic.id}: ${topic.name}`);
    const topicSources = sources.filter((source) => (topic.source_ids || []).includes(source.id));
    if (topicSources.length === 0) {
      console.log("  sources: none");
      continue;
    }
    for (const source of topicSources) {
      console.log(`  - [${source.enabled ? "on" : "off"}] ${source.id} ${source.method} ${source.access_scope} ${shortUrl(source.url)}`);
    }
  }
}

function shortUrl(url) {
  const value = String(url || "");
  if (value.startsWith("data:")) return `${value.slice(0, 48)}...`;
  return value.length > 120 ? `${value.slice(0, 117)}...` : value;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
