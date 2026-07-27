#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { KagiClient, formatResults } from "./kagi.js";

const client = new KagiClient(process.env.KAGI_SESSION_TOKEN);

const server = new McpServer({
  name: "kagi-mcp",
  version: "1.0.0",
});

// Fresh instance per field — sharing one zod instance makes the JSON schema
// emit a $ref, which some MCP clients don't resolve.
const DATE = () =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
    .optional();

function asToolResult(promise) {
  return promise.then(
    (parsed) => ({ content: [{ type: "text", text: formatResults(parsed) }] }),
    (err) => ({ content: [{ type: "text", text: `Error: ${err.message}` }], isError: true })
  );
}

server.registerTool(
  "kagi_search",
  {
    title: "Kagi web search",
    description:
      "Search the web with Kagi (high-quality, ad-free results). Returns titles, URLs, dates and snippets. " +
      "The query supports operators: \"exact phrase\", site:example.com, -excludeterm, OR. " +
      "Use from_date/to_date to restrict by publication date, page for more results, region for " +
      "country-specific results, and lens to restrict to a curated scope (forums, academic, ...).",
    inputSchema: {
      query: z.string().min(1).describe("Search query (supports quotes, site:, -exclusion, OR)"),
      page: z.number().int().min(1).max(10).optional().describe("Result page, default 1"),
      from_date: DATE().describe("Only results published on/after this date (YYYY-MM-DD)"),
      to_date: DATE().describe("Only results published on/before this date (YYYY-MM-DD)"),
      region: z
        .string()
        .regex(/^([a-zA-Z]{2}|no_region)$/, 'must be a 2-letter country code or "no_region"')
        .optional()
        .describe(
          'Result region: 2-letter country code ("us", "cn", "jp", "de", ...). Default: "no_region" ' +
            "(international, location-neutral) — set a country code when the question is region-specific."
        ),
      lens: z
        .string()
        .optional()
        .describe(
          'Restrict results to a Kagi lens, by name or numeric id — e.g. "Forums" (Reddit-style discussions), ' +
            '"Fediverse Forums" (decentralized forums like Lemmy), "Academic", "Programming", "PDFs", "Usenet/Archive", ' +
            '"News 360". Call kagi_lenses for the full list on this account.'
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("Max results to return (default: the full results page, typically 20-40)"),
    },
  },
  ({ query, page = 1, from_date, to_date, limit, region, lens }) =>
    asToolResult(client.search({ query, page, fromDate: from_date, toDate: to_date, limit, region, lens }))
);

server.registerTool(
  "kagi_lenses",
  {
    title: "List Kagi lenses",
    description:
      "List the Kagi lenses (curated search scopes such as Forums, Academic, Programming) available on this " +
      "account, with their ids. Pass a lens name or id to kagi_search's lens parameter.",
    inputSchema: {},
  },
  () =>
    client.listLenses().then(
      (lenses) => ({
        content: [
          {
            type: "text",
            text: lenses.length
              ? "Available Kagi lenses (use name or id with kagi_search):\n" +
                lenses.map((l) => `- ${l.name} (id ${l.id})`).join("\n")
              : "No lenses found on this account.",
          },
        ],
      }),
      (err) => ({ content: [{ type: "text", text: `Error: ${err.message}` }], isError: true })
    )
);

server.registerTool(
  "kagi_news",
  {
    title: "Kagi news search",
    description:
      "Search recent news with Kagi. Returns headlines with source, publication time and snippets. " +
      "Best for current events; use kagi_search for general web results.",
    inputSchema: {
      query: z.string().min(1).describe("News search query"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("Max results to return (default: the full news page, typically 25-45)"),
    },
  },
  ({ query, limit }) => asToolResult(client.news({ query, limit }))
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("kagi-mcp server running on stdio");
