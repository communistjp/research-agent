# ChatGPT app mode

This mode lets ChatGPT call `research-agent` through an Apps SDK/MCP connector.
It does not use a GitHub token or an OpenAI API key in the browser. ChatGPT reads
the structured news returned by the tool and summarizes it for the active
ChatGPT user.

## Local run

Node 20 or newer is recommended for the current Apps SDK packages.

```sh
cmd /c npm install
cmd /c npm run build
cmd /c npm run pages:update
cmd /c npm run chatgpt:app
```

The connector endpoint is:

```text
http://localhost:8790/mcp
```

For ChatGPT to reach it during development, expose the port through an HTTPS
tunnel such as ngrok or Cloudflare Tunnel, then register the public URL ending
in `/mcp` in ChatGPT settings.

## Refresh policy

By default the app server is read-only and returns cached `latest.json`.

To allow the ChatGPT widget's load button to refresh the cache only when it is
stale, set:

```sh
set CHATGPT_APP_ENABLE_REFRESH=1
set NEWS_MIN_REFRESH_MINUTES=120
cmd /c npm run chatgpt:app
```

The server enforces `NEWS_MIN_REFRESH_MINUTES`; repeated button presses return
the cached bundle until the interval has passed.

## Why not Codex app-server

`codex app-server` is a protocol for rich Codex clients. It is not a public web
billing or identity bridge for a visitor's ChatGPT account. For visitor-owned
ChatGPT execution, use ChatGPT Apps SDK/MCP and have each user add the connector
from ChatGPT.
