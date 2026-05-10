import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { extname, join, resolve } from "node:path";
import { readFile, stat } from "node:fs/promises";

const root = process.cwd();
const publicDir = resolve(root, "outputs", "public");
const host = process.env.NEWS_DASHBOARD_HOST || "0.0.0.0";
const port = Number(process.env.NEWS_DASHBOARD_PORT || "8787");

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};

function responseHeaders(type) {
  return {
    "content-type": type,
    "cache-control": "no-store"
  };
}

function localUrls() {
  const urls = [`http://localhost:${port}/`];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) {
        urls.push(`http://${entry.address}:${port}/`);
      }
    }
  }
  return urls;
}

function safePath(requestUrl) {
  const url = new URL(requestUrl || "/", `http://${host}:${port}`);
  const pathname = decodeURIComponent(url.pathname);
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const candidate = resolve(join(publicDir, relative));
  if (!candidate.startsWith(publicDir)) return "";
  return candidate;
}

async function fileResponse(path) {
  const info = await stat(path);
  if (!info.isFile()) return null;
  const body = await readFile(path);
  const type = contentTypes[extname(path).toLowerCase()] || "application/octet-stream";
  return { body, type };
}

const server = createServer(async (request, response) => {
  if (!["GET", "HEAD"].includes(request.method || "")) {
    response.writeHead(405, responseHeaders("text/plain; charset=utf-8"));
    response.end("Method not allowed");
    return;
  }

  try {
    const path = safePath(request.url);
    if (!path) {
      response.writeHead(403, responseHeaders("text/plain; charset=utf-8"));
      response.end("Forbidden");
      return;
    }

    const file = await fileResponse(path);
    if (!file) throw new Error("Not found");
    response.writeHead(200, responseHeaders(file.type));
    if (request.method === "HEAD") response.end();
    else response.end(file.body);
  } catch {
    response.writeHead(404, responseHeaders("text/html; charset=utf-8"));
    response.end(`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><p>News dashboard is not generated yet. Run <code>cmd /c npm run news:refresh</code>.</p>`);
  }
});

server.listen(port, host, () => {
  console.log(`Research Agent News server listening on ${host}:${port}`);
  for (const url of localUrls()) console.log(`- ${url}`);
});
