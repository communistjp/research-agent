import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const root = process.cwd();
const port = Number(process.env.CHATGPT_APP_PORT || process.env.PORT || "8790");
const mcpPath = "/mcp";
const widgetUri = "ui://widget/research-agent-news.html";
const widgetPath = resolve(root, "docs", "chatgpt-news-widget.html");
const widgetHtml = readFileSync(widgetPath, "utf8");
const minRefreshMinutes = Number(process.env.NEWS_MIN_REFRESH_MINUTES || "120");
const enableRefresh = process.env.CHATGPT_APP_ENABLE_REFRESH === "1";
const readNewsInputSchema = {
  limit: z.number().int().min(1).max(20).optional(),
  refresh: z.enum(["cached", "if_stale"]).optional()
};
const sourceOutputSchema = z.object({
  title: z.string(),
  original_title: z.string(),
  source_name: z.string(),
  url: z.string(),
  published_at: z.string(),
  topic: z.string()
});
const storyOutputSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  time_label: z.string(),
  representative_published_at: z.string(),
  media_count: z.number(),
  article_count: z.number(),
  tags: z.array(z.string()),
  sources: z.array(sourceOutputSchema)
});
const newsOutputSchema = {
  generated_at: z.string(),
  topics: z.array(z.string()),
  counts: z.record(z.any()),
  top: z.array(storyOutputSchema),
  refresh_policy: z.object({
    mode: z.string(),
    min_refresh_minutes: z.number(),
    refreshed: z.boolean(),
    source_file: z.string()
  })
};

let refreshPromise = null;

function latestCandidates() {
  return [
    resolve(root, "outputs", "public", "latest.json"),
    resolve(root, "docs", "latest.json")
  ];
}

async function loadLatestJson() {
  for (const candidate of latestCandidates()) {
    if (!existsSync(candidate)) continue;
    const [body, info] = await Promise.all([readFile(candidate, "utf8"), stat(candidate)]);
    return {
      path: candidate,
      label: candidate.includes(`${resolve(root, "outputs", "public")}`) ? "outputs/public/latest.json" : "docs/latest.json",
      modifiedAt: info.mtime,
      data: JSON.parse(body)
    };
  }
  throw new Error("latest.json was not found. Run cmd /c npm run pages:update first.");
}

function staleEnough(generatedAt) {
  const generated = Date.parse(generatedAt || "");
  if (!Number.isFinite(generated)) return true;
  const ageMs = Date.now() - generated;
  return ageMs >= minRefreshMinutes * 60 * 1000;
}

function refreshCommand() {
  if (process.platform === "win32") {
    return { command: "cmd", args: ["/c", "npm", "run", "pages:update"] };
  }
  return { command: "npm", args: ["run", "pages:update"] };
}

async function refreshNewsIfAllowed(currentNews, refreshMode) {
  if (refreshMode !== "if_stale") return false;
  if (!enableRefresh) return false;
  if (!staleEnough(currentNews?.data?.generated_at)) return false;

  if (!refreshPromise) {
    const { command, args } = refreshCommand();
    refreshPromise = new Promise((resolveRefresh, rejectRefresh) => {
      const child = spawn(command, args, {
        cwd: root,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"]
      });
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        output += String(chunk);
      });
      child.on("error", rejectRefresh);
      child.on("close", (code) => {
        if (code === 0) {
          resolveRefresh();
          return;
        }
        rejectRefresh(new Error(`pages:update failed with exit code ${code}\n${output}`));
      });
    }).finally(() => {
      refreshPromise = null;
    });
  }

  await refreshPromise;
  return true;
}

function textValue(value) {
  return typeof value === "string" ? value : "";
}

function numberValue(value) {
  return Number.isFinite(value) ? value : 0;
}

function normalizeSource(source) {
  return {
    title: textValue(source?.title),
    original_title: textValue(source?.original_title),
    source_name: textValue(source?.source_name),
    url: textValue(source?.url),
    published_at: textValue(source?.published_at),
    topic: textValue(source?.topic)
  };
}

function normalizeStory(story) {
  return {
    id: textValue(story?.id),
    title: textValue(story?.title),
    body: textValue(story?.body),
    time_label: textValue(story?.time_label),
    representative_published_at: textValue(story?.representative_published_at),
    media_count: numberValue(story?.media_count),
    article_count: numberValue(story?.article_count),
    tags: Array.isArray(story?.tags) ? story.tags.map(textValue).filter(Boolean) : [],
    sources: Array.isArray(story?.sources) ? story.sources.map(normalizeSource) : []
  };
}

function normalizeNews(news, limit, sourcePath, refreshed) {
  const data = news?.data || {};
  const top = Array.isArray(data.top) ? data.top.map(normalizeStory) : [];
  return {
    generated_at: textValue(data.generated_at),
    topics: Array.isArray(data.topics) ? data.topics.map(textValue).filter(Boolean) : [],
    counts: data.counts && typeof data.counts === "object" ? data.counts : {},
    top: top.slice(0, limit),
    refresh_policy: {
      mode: enableRefresh ? "server_refresh_if_stale" : "cached_only",
      min_refresh_minutes: minRefreshMinutes,
      refreshed,
      source_file: sourcePath
    }
  };
}

function replyWithNews(news) {
  return {
    content: [{
      type: "text",
      text: [
        `Research Agent News loaded ${news.top.length} stories.`,
        "Summarize in Japanese, group related articles, and mention the concrete event timing from time_label or source dates when useful."
      ].join(" ")
    }],
    structuredContent: news
  };
}

function createResearchAgentAppServer() {
  const server = new McpServer({ name: "research-agent-news", version: "0.1.0" });

  registerAppResource(
    server,
    "research-agent-news-widget",
    widgetUri,
    {},
    async () => ({
      contents: [{
        uri: widgetUri,
        mimeType: RESOURCE_MIME_TYPE,
        text: widgetHtml
      }]
    })
  );

  registerAppTool(
    server,
    "read_research_agent_news",
    {
      title: "Read Research Agent News",
      description: [
        "Loads the latest cached Research Agent world news bundle.",
        "Use this when the user wants a Japanese briefing on geopolitics, global economy, BRICS, energy, AI, OpenAI, and security.",
        "The tool does not call the OpenAI API; ChatGPT should summarize the returned structured news for the active user."
      ].join(" "),
      inputSchema: readNewsInputSchema,
      outputSchema: newsOutputSchema,
      _meta: {
        ui: { resourceUri: widgetUri }
      }
    },
    async (args) => {
      const limit = args?.limit || 12;
      let latest = await loadLatestJson();
      const refreshed = await refreshNewsIfAllowed(latest, args?.refresh || "cached");
      if (refreshed) latest = await loadLatestJson();
      return replyWithNews(normalizeNews(latest, limit, latest.label, refreshed));
    }
  );

  return server;
}

const httpServer = createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400).end("Missing URL");
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "OPTIONS" && url.pathname === mcpPath) {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, mcp-session-id",
      "Access-Control-Expose-Headers": "Mcp-Session-Id"
    });
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end(`Research Agent ChatGPT app server. Connector URL: http://localhost:${port}${mcpPath}`);
    return;
  }

  const mcpMethods = new Set(["POST", "GET", "DELETE"]);
  if (url.pathname === mcpPath && req.method && mcpMethods.has(req.method)) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
    const server = createResearchAgentAppServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    });

    res.on("close", () => {
      transport.close();
      server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error("Error handling MCP request:", error);
      if (!res.headersSent) res.writeHead(500).end("Internal server error");
    }
    return;
  }

  res.writeHead(404).end("Not Found");
});

httpServer.listen(port, () => {
  console.log(`Research Agent ChatGPT app server listening on http://localhost:${port}${mcpPath}`);
  if (!enableRefresh) {
    console.log("Server-side refresh is disabled. Set CHATGPT_APP_ENABLE_REFRESH=1 to allow refresh=if_stale.");
  }
});
