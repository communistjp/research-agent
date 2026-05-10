import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(root, "outputs", "public", "latest.json");
const target = join(root, "docs", "latest.json");

await JSON.parse(await readFile(source, "utf8"));
await mkdir(dirname(target), { recursive: true });
await copyFile(source, target);
console.log(`Exported GitHub Pages news data to ${target}`);
