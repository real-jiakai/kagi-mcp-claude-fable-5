#!/usr/bin/env node
// Smoke test that exercises the client directly (no MCP transport).
//   $env:KAGI_SESSION_TOKEN='<token or session link>'; node test.js "your query"
//   node test.js "tokyo" news       <- news vertical
import { KagiClient, formatResults } from "./src/kagi.js";

const query = process.argv[2] || "capital of japan";
const mode = (process.argv[3] || "web").toLowerCase();

const client = new KagiClient(process.env.KAGI_SESSION_TOKEN);

try {
  const parsed =
    mode === "news"
      ? await client.news({ query, limit: 5 })
      : await client.search({ query, limit: 5 });
  console.log(formatResults(parsed));
  console.log(`\n--- OK: ${parsed.results.length} results parsed ---`);
} catch (err) {
  console.error(`FAILED: ${err.message}`);
  process.exitCode = 1;
}
