# kagi-mcp

**English** | [简体中文](README.zh-CN.md)

MCP server for [Kagi Search](https://kagi.com) that authenticates with your **session token** —
no separate API subscription needed, it uses your existing Kagi plan via Kagi's lightweight
HTML interface (`kagi.com/html/search`).

## Tools

| Tool | Purpose | Parameters |
|---|---|---|
| `kagi_search` | Web search | `query` (required), `page`, `from_date`, `to_date`, `region`, `lens`, `limit` |
| `kagi_news` | News search | `query` (required), `limit` |
| `kagi_lenses` | List available lenses | — |

- `region`: 2-letter country code (`us`, `cn`, `jp`, ...); maps to Kagi's `r=` parameter.
  Defaults to `no_region` (international/location-neutral) so the AI agent decides when a
  country-specific view is needed.
- `lens`: a Kagi lens by **name or numeric id** (e.g. `Forums`, `Fediverse Forums`,
  `Academic`, `Programming`, `PDFs`). Names are resolved against the lens list on your
  account (cached per server process — restart the server after creating new lenses).

Queries support Kagi operators: `"exact phrase"`, `site:example.com`, `-exclude`, `OR`.
Output is compact plain text (title, URL, date, snippet, related searches). By default a
call returns the **full first results page** — the same set a user sees on kagi.com
(typically 20-40 results); pass `limit` to trim it. Snippets are Kagi's own SERP snippets;
fetching full page content is left to the agent's page-fetch tool.

## 1. Get your session token

1. Open [kagi.com/settings/user_details](https://kagi.com/settings/user_details)
2. Find the **Session Link** section and copy the link.
3. Use either the full link (`https://kagi.com/search?token=...`) or just the token part —
   both work as `KAGI_SESSION_TOKEN`.

> **Treat the session link like a password** — anyone with it can use your Kagi account.
> If it leaks, generate a new one from the same settings page (this invalidates the old one).

## 2. Install

Requires [Node.js](https://nodejs.org) 18+.

**Option A — npx (quickest, no clone).** Nothing to install up front; your MCP client runs
the published package directly with `npx -y kagi-mcp-claude-fable-5` (see the configs below).

**Option B — from source:**

```bash
git clone https://github.com/real-jiakai/kagi-mcp-claude-fable-5.git kagi-mcp
cd kagi-mcp
npm install
```

## 3. Smoke test

macOS / Linux:

```bash
KAGI_SESSION_TOKEN='<token or session link>' node test.js "capital of japan"   # web search
KAGI_SESSION_TOKEN='<token or session link>' node test.js "tokyo" news         # news search
```

Windows (PowerShell):

```powershell
$env:KAGI_SESSION_TOKEN = '<token or session link>'
node test.js "capital of japan"
```

## 4. Hook it up

The examples use the npx form. Running from source instead? Replace
`npx -y kagi-mcp-claude-fable-5` with `node /path/to/kagi-mcp/src/index.js`
(Windows JSON needs escaped backslashes: `"C:\\path\\to\\kagi-mcp\\src\\index.js"`).

### Claude Code

```bash
claude mcp add kagi -s user --env KAGI_SESSION_TOKEN=<token> -- npx -y kagi-mcp-claude-fable-5
```

(`-s user` makes the server available in all your projects; omit it for project-local.)

### Claude Desktop / any MCP client (JSON config)

```json
{
  "mcpServers": {
    "kagi": {
      "command": "npx",
      "args": ["-y", "kagi-mcp-claude-fable-5"],
      "env": { "KAGI_SESSION_TOKEN": "<token or session link>" }
    }
  }
}
```

### OpenClaw

```bash
openclaw mcp add kagi \
  --command npx \
  --arg -y \
  --arg kagi-mcp-claude-fable-5 \
  --env KAGI_SESSION_TOKEN=<token>
```

Verify with `openclaw mcp doctor kagi --probe`.

### Hermes Agent

Add to `~/.hermes/config.yaml` under `mcp_servers`:

```yaml
mcp_servers:
  kagi:
    command: "npx"
    args: ["-y", "kagi-mcp-claude-fable-5"]
    env:
      KAGI_SESSION_TOKEN: "<token or session link>"
```

## Notes

- **Auth failures**: if the token is invalid/expired, Kagi 302-redirects to its landing page;
  the server detects this and returns a clear error telling you to refresh the token.
- **Parsing**: results are extracted via Kagi's own machine-readable markers
  (`._0_SRI`, `a._0_URL`, `._0_TITLE`, `._0_DESC`), which are stable across the web and
  news verticals (verified July 2026). If Kagi ever changes its markup, update
  `parseResultsPage()` in `src/kagi.js`.
- This uses your normal Kagi account the same way a browser would — standard fair-use search
  volume from an agent is indistinguishable from regular usage. It is not the official
  [Kagi Search API](https://help.kagi.com/kagi/api/search.html) (which bills separately).

## Acknowledgements

Designed, implemented, and tested end-to-end with **[Claude Fable 5](https://www.anthropic.com/news/claude-fable-5-mythos-5)**
via Claude Code — including live analysis of Kagi's HTML interface, an adversarial
multi-agent code review, and human-click vs. MCP parity testing in the browser.
