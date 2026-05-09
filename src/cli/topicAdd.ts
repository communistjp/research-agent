import { parseArgs, csv, requireArg } from "./args.ts";
import { readJsonConfig, slugify, uniqueById, writeJsonConfig } from "../config/configIo.ts";

async function main() {
  const root = process.cwd();
  const args = parseArgs(process.argv.slice(2));
  const name = requireArg(args, "name");
  const id = args.id || slugify(name);
  const topics = await readJsonConfig(root, "watch_topics.json", []);

  const existing = topics.find((topic) => topic.id === id);
  if (existing) {
    existing.name = name;
    existing.keywords = Array.from(new Set([...existing.keywords, ...csv(args.keywords)]));
    existing.enabled = args.enable ? true : existing.enabled;
    console.log(`Updated existing topic ${id}`);
  } else {
    topics.push({
      id,
      name,
      keywords: csv(args.keywords).length ? csv(args.keywords) : [name],
      source_ids: [],
      enabled: Boolean(args.enable)
    });
    console.log(`Added topic ${id}`);
  }

  await writeJsonConfig(root, "watch_topics.json", uniqueById(topics));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
