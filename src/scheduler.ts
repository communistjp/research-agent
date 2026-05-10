import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
let running = false;

async function readScheduleConfig() {
  try {
    return JSON.parse(await readFile(join(root, "config", "schedule.json"), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

function parseTimes(value) {
  const raw = Array.isArray(value) ? value : String(value || "").split(",");
  return raw
    .map((item) => String(item).trim())
    .filter(Boolean)
    .map((item) => {
      const match = item.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
      if (!match) throw new Error(`Invalid schedule time: ${item}. Use HH:mm.`);
      return { label: `${match[1].padStart(2, "0")}:${match[2]}`, hour: Number(match[1]), minute: Number(match[2]) };
    })
    .sort((left, right) => left.hour - right.hour || left.minute - right.minute);
}

function nextRunDelay(times, now = new Date()) {
  const candidates = [];
  for (const time of times) {
    const today = new Date(now);
    today.setHours(time.hour, time.minute, 0, 0);
    if (today > now) candidates.push({ date: today, time });

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    candidates.push({ date: tomorrow, time });
  }

  candidates.sort((left, right) => left.date - right.date);
  const next = candidates[0];
  return { next, delayMs: next.date.getTime() - now.getTime() };
}

function runOnce(reason = "scheduled") {
  if (running) {
    console.log(`Skipping ${reason} run because the previous run is still active.`);
    return;
  }

  running = true;
  const child = spawn(process.execPath, ["dist/index.js"], {
    cwd: root,
    stdio: "inherit",
    shell: false
  });

  child.on("exit", (code) => {
    running = false;
    if (code !== 0) {
      console.error(`research-agent run exited with code ${code}`);
    }
  });
}

function scheduleDaily(times) {
  const { next, delayMs } = nextRunDelay(times);
  console.log(`Next research-agent run: ${next.date.toString()} (${next.time.label})`);
  setTimeout(() => {
    runOnce(next.time.label);
    scheduleDaily(times);
  }, delayMs);
}

async function main() {
  const config = await readScheduleConfig();
  const configuredTimes = process.env.RESEARCH_AGENT_SCHEDULE_TIMES || config.times;
  const times = parseTimes(configuredTimes);
  const runOnStart = String(process.env.RESEARCH_AGENT_RUN_ON_START ?? config.run_on_start ?? "true") !== "false";

  if (times.length) {
    console.log(`Starting research-agent daily scheduler: ${times.map((time) => time.label).join(", ")}`);
    if (runOnStart) runOnce("startup");
    scheduleDaily(times);
    return;
  }

  const intervalMinutes = Number(process.env.RESEARCH_AGENT_INTERVAL_MINUTES || config.interval_minutes || "60");
  const intervalMs = Math.max(intervalMinutes, 1) * 60 * 1000;
  console.log(`Starting research-agent scheduler at ${intervalMinutes} minute interval.`);
  if (runOnStart) runOnce("startup");
  setInterval(() => runOnce("interval"), intervalMs);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
