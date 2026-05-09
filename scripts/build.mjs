import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, "dist");

async function listTsFiles(dir, prefix = "") {
  const entries = await readdir(join(root, dir), { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relative = join(dir, entry.name).replaceAll("\\", "/");
    if (entry.isDirectory()) {
      files.push(...await listTsFiles(relative, prefix));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(relative);
    }
  }

  return files;
}

const files = await listTsFiles("src");

await rm(dist, { recursive: true, force: true });

for (const relative of files) {
  const sourcePath = join(root, relative);
  const outRelative = relative.replace(/^src\//, "").replace(/\.ts$/, ".js");
  const outPath = join(dist, outRelative);
  let source = await readFile(sourcePath, "utf8");
  source = source.replaceAll(".ts\"", ".js\"").replaceAll(".ts'", ".js'");
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, source, "utf8");

  const check = spawnSync(process.execPath, ["--check", outPath], { encoding: "utf8" });
  if (check.status !== 0) {
    throw new Error(`Syntax check failed for ${outRelative}\n${check.stderr || check.stdout}`);
  }
}

console.log(`Built ${files.length} files into dist/`);
