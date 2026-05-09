import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

async function readJsonIfExists(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

export async function persistRun(root, run) {
  const dir = join(root, "outputs", "store");
  await mkdir(dir, { recursive: true });

  const recordsPath = join(dir, "records.json");
  const statePath = join(dir, "state.json");
  const existing = await readJsonIfExists(recordsPath, []);
  const byKey = new Map();

  for (const record of existing) {
    byKey.set(recordKey(record), record);
  }
  for (const record of run.records) {
    byKey.set(recordKey(record), { ...record, run_id: run.run_id });
  }

  const nextRecords = [...byKey.values()];

  await writeFile(recordsPath, JSON.stringify(nextRecords, null, 2), "utf8");
  await writeFile(statePath, JSON.stringify({
    last_run_id: run.run_id,
    last_run_at: run.started_at,
    record_count: nextRecords.length,
    latest_topics: run.topics
  }, null, 2), "utf8");

  return { recordsPath, statePath };
}

function recordKey(record) {
  const url = String(record.url || "");
  return [
    record.source_name || "",
    url.startsWith("data:") ? "data-fixture" : url,
    record.title || ""
  ].join("\u001f").toLowerCase();
}
