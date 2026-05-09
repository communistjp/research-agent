import { spawn } from "node:child_process";

const intervalMinutes = Number(process.env.RESEARCH_AGENT_INTERVAL_MINUTES || "60");
const intervalMs = Math.max(intervalMinutes, 1) * 60 * 1000;

function runOnce() {
  const child = spawn(process.execPath, ["dist/index.js"], {
    cwd: process.cwd(),
    stdio: "inherit",
    shell: false
  });

  child.on("exit", (code) => {
    if (code !== 0) {
      console.error(`research-agent run exited with code ${code}`);
    }
  });
}

console.log(`Starting research-agent scheduler at ${intervalMinutes} minute interval.`);
runOnce();
setInterval(runOnce, intervalMs);
