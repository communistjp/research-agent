import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function readJsonConfig(root, name, fallback = null) {
  try {
    return JSON.parse(await readFile(join(root, "config", name), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" && fallback !== null) return fallback;
    throw error;
  }
}

export async function writeJsonConfig(root, name, value) {
  await writeFile(join(root, "config", name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function slugify(input) {
  return String(input || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function uniqueById(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    if (!item?.id || seen.has(item.id)) continue;
    seen.add(item.id);
    result.push(item);
  }
  return result;
}
