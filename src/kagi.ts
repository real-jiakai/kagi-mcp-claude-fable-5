import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";

const BASE = "https://kagi.com";
const TIMEOUT_MS = 20000;

export interface KagiResult {
  title: string;
  url: string;
  snippet?: string;
  time?: string;
  group?: string;
}

export interface ParsedResultsPage {
  results: KagiResult[];
  related: string[];
}

export interface SearchResponse extends ParsedResultsPage {
  query: string;
  page?: number;
  region?: string;
  lens?: string;
  /** Total parsed results when `limit` clipped the list. */
  clipped?: number;
}

export interface Lens {
  name: string;
  id: string;
}

export interface SearchOptions {
  /** Supports Kagi operators: "exact", site:, -exclude, OR... */
  query: string;
  /** 1-based page number (Kagi "batch" param). */
  page?: number;
  /** YYYY-MM-DD */
  fromDate?: string;
  /** YYYY-MM-DD */
  toDate?: string;
  limit?: number;
  /** ISO country code ("us", "cn"...); defaults to "no_region" (international). */
  region?: string;
  /** Lens name or numeric lens id. */
  lens?: string | number;
}

/**
 * Accepts either a bare session token or a full Kagi session link
 * (https://kagi.com/search?token=XXXX) and returns the bare token.
 */
export function resolveToken(raw: string | undefined | null): string | null {
  if (!raw) return null;
  raw = raw.trim();
  const m = raw.match(/[?&]token=([^&\s]+)/);
  let token = raw;
  if (m) {
    try {
      token = decodeURIComponent(m[1]);
    } catch {
      token = m[1]; // malformed %-escape: keep as-is; the auth check reports it cleanly if wrong
    }
  }
  // Cookie header values may only contain printable ASCII. Strip anything else so a
  // malformed token can never make fetch() throw a header-validation error that
  // echoes the credential back into tool output.
  token = token.replace(/[^\x21-\x7E]/g, "");
  return token || null;
}

export class KagiAuthError extends Error {}

// Maps low-level fetch failures to a readable message. undici hides the real
// reason (ECONNREFUSED, ENOTFOUND, TLS...) inside err.cause.
const unreachable = (err: unknown): Error => {
  const e = err as { name?: string; message?: string; cause?: { message?: string } } | null;
  const reason =
    e?.name === "TimeoutError" ? "request timed out" : e?.cause?.message || e?.message || String(err);
  return new Error(`Could not reach kagi.com: ${reason}`);
};

export class KagiClient {
  readonly token: string | null;
  private _lenses?: Lens[];

  constructor(token?: string | null) {
    this.token = resolveToken(token);
  }

  async fetchHtml(path: string, params: Record<string, string | number | undefined> = {}): Promise<string> {
    if (!this.token) {
      throw new KagiAuthError(
        "No Kagi session token configured. Set the KAGI_SESSION_TOKEN environment variable " +
          "to your session token or full session link (kagi.com → Settings → Session Link)."
      );
    }
    const url = new URL(path, BASE);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          Cookie: `kagi_session=${this.token}`,
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 kagi-mcp/1.0",
          Accept: "text/html",
        },
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw unreachable(err);
    }
    if (!res.ok) {
      // Release the socket — an unconsumed body keeps the connection (and process) alive.
      await res.body?.cancel().catch(() => {});
    }
    // Unauthenticated requests get a 302 to /welcome (or /signin).
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location") || "";
      if (/welcome|signin|login/i.test(loc) || loc === "/" || loc === "") {
        throw new KagiAuthError(
          "Kagi rejected the session token (redirected to the login page). The token is invalid, expired, " +
            "or was revoked. Copy a fresh session link from kagi.com → Settings → Session Link and update " +
            "KAGI_SESSION_TOKEN."
        );
      }
      throw new Error(`Kagi redirected unexpectedly to ${loc}.`);
    }
    if (res.status === 429) {
      throw new Error("Kagi rate-limited the request (HTTP 429). Wait a moment and try again.");
    }
    if (!res.ok) {
      throw new Error(`Kagi returned HTTP ${res.status}.`);
    }
    // The timeout signal also governs body download, so failures here need the
    // same mapping as the fetch() call (kept separate so the intentional
    // auth/429/status errors above are not re-wrapped).
    try {
      return await res.text();
    } catch (err) {
      throw unreachable(err);
    }
  }

  /**
   * Lenses (curated search scopes) available on this account, parsed from the
   * search page's filter panel. Cached for the process lifetime.
   */
  async listLenses(): Promise<Lens[]> {
    if (this._lenses) return this._lenses;
    const html = await this.fetchHtml("/html/search", { q: "kagi" });
    const $ = cheerio.load(html);
    const lenses: Lens[] = [];
    $(".filter-lens-item a").each((_, a) => {
      const name = cleanText($(a).text());
      const m = ($(a).attr("href") || "").match(/[?&]lens=(\d+)/);
      if (name && m && !lenses.some((l) => l.id === m[1])) lenses.push({ name, id: m[1] });
    });
    if (lenses.length) this._lenses = lenses;
    return lenses;
  }

  /** Accepts a numeric lens id or a lens name; returns the id (or undefined). */
  async resolveLens(lens: string | number | undefined | null): Promise<string | undefined> {
    if (lens === undefined || lens === null || lens === "") return undefined;
    const s = String(lens).trim();
    if (/^\d+$/.test(s)) return s;
    const lenses = await this.listLenses();
    const hit = lenses.find((l) => l.name.toLowerCase() === s.toLowerCase());
    if (!hit) {
      const names = lenses.map((l) => `${l.name} (${l.id})`).join(", ");
      throw new Error(`Unknown lens "${s}". Available lenses: ${names || "none found on this account"}.`);
    }
    return hit.id;
  }

  /** Web search via Kagi's lightweight HTML interface. */
  async search({ query, page = 1, fromDate, toDate, limit, region, lens }: SearchOptions): Promise<SearchResponse> {
    if (region === undefined || region === null || region === "") region = "no_region";
    const r = String(region).trim().toLowerCase();
    if (!/^([a-z]{2}|no_region)$/.test(r)) {
      throw new Error(`Invalid region "${region}" — use a 2-letter country code (e.g. "us", "cn") or "no_region".`);
    }
    const lensId = await this.resolveLens(lens);
    const html = await this.fetchHtml("/html/search", {
      q: query,
      batch: page > 1 ? page : undefined,
      from_date: fromDate,
      to_date: toDate,
      r,
      lens: lensId,
    });
    const parsed = parseResultsPage(html);
    return { query, page, region: r, lens: lens ? String(lens) : undefined, ...clip(parsed, limit) };
  }

  /** News search via Kagi's lightweight HTML interface. */
  async news({ query, limit }: { query: string; limit?: number }): Promise<SearchResponse> {
    const html = await this.fetchHtml("/html/news", { q: query });
    // The news page opens with a headline-only "top stories" widget; prefer the
    // full news items (with time + snippet) when present.
    const parsed = parseResultsPage(html, { prefer: ".newsResultItem" });
    // No `page` here — the news tool has no paging parameter, and formatResults
    // only emits paging hints when page is set.
    return { query, ...clip(parsed, limit) };
  }
}

function clip(parsed: ParsedResultsPage, limit?: number): ParsedResultsPage & { clipped?: number } {
  if (limit && limit > 0 && parsed.results.length > limit) {
    return { ...parsed, results: parsed.results.slice(0, limit), clipped: parsed.results.length };
  }
  return parsed;
}

/**
 * Parses a Kagi /html/* results page.
 * Kagi marks every organic result with `._0_SRI`, its link with `a._0_URL`,
 * title with `._0_TITLE` and snippet with `._0_DESC` (verified July 2026 on
 * both the web and news verticals).
 */
export function parseResultsPage(html: string, { prefer }: { prefer?: string } = {}): ParsedResultsPage {
  const $: CheerioAPI = cheerio.load(html);
  const results: KagiResult[] = [];
  const seen = new Set<string>();

  let itemSelector = "._0_SRI";
  if (prefer && $(prefer).length > 0) itemSelector = prefer;

  $(itemSelector).each((_, el) => {
    const $el = $(el);
    const link = $el.find("a._0_URL").first();
    const url = (link.attr("href") || "").trim();
    if (!/^https?:\/\//i.test(url)) return; // skip internal/JS links
    if (seen.has(url)) return; // widgets can duplicate organic results
    seen.add(url);

    // The title element can contain the per-result "more menu" dropdown; strip it.
    const $title = $el.find("._0_TITLE").first().clone();
    $title.find('[class*="menu"], [class*="dropdown"]').remove();
    const title =
      cleanText($title.text()) ||
      cleanText($el.find("a.__sri_title_link").first().text()) ||
      cleanText(link.text()) ||
      url;

    // The description box nests the time span and the "Summarize" control; drop both.
    const $desc = $el.find("._0_DESC, .__sri-desc").first().clone();
    $desc.find(".__sri-time, .newsResultTime").remove();
    $desc.find("a, button, span").each((_, n) => {
      if (cleanText($(n).text()) === "Summarize") $(n).remove();
    });
    let snippet = cleanText($desc.text());
    snippet = snippet.replace(/\s*Summarize\s*$/i, "");
    const time = cleanText($el.find(".newsResultTime, .__sri-time").first().text());

    // Results inside inline widgets (Videos, Interesting Finds, ...) get a group label.
    const widget = $el.closest(".inline-content");
    let group: string | null = null;
    if (widget.length) {
      group = cleanText(widget.find(".widget-header").first().text()) || null;
      if (group) group = group.replace(/\s*(Show more|More).*$/i, "").trim() || null;
    }

    results.push({
      title,
      url,
      snippet: snippet || undefined,
      time: time || undefined,
      group: group || undefined,
    });
  });

  const related: string[] = [];
  $(".related-searches a").each((_, a) => {
    const t = cleanText($(a).text());
    if (t && !related.includes(t)) related.push(t);
  });

  // A genuine zero-hit page still carries the results-page chrome. Without it,
  // this is an empty body, challenge/maintenance page, or a Kagi markup change —
  // report that instead of a misleading "no results".
  if (results.length === 0) {
    const looksLikeResultsPage =
      $('input[name="q"]').length > 0 ||
      $("._0_main-search-results, .footer-search-results, .related-searches").length > 0;
    if (!looksLikeResultsPage) {
      throw new Error(
        "Kagi returned an unexpected page instead of search results (possibly a " +
          "challenge/maintenance page, an empty response, or a markup change). " +
          "Try again; if it persists, check the session token and kagi.com/html/search in a browser."
      );
    }
  }

  return { results, related };
}

function cleanText(s: string | undefined | null): string {
  return (s || "").replace(/\s+/g, " ").trim();
}

/** Compact, LLM-friendly plain-text rendering. */
export function formatResults({ query, page, region, lens, results, related, clipped }: SearchResponse): string {
  const scope = [
    page && page > 1 ? `page ${page}` : null,
    region ? `region ${region}` : null,
    lens ? `lens ${lens}` : null,
  ].filter(Boolean);
  const scopeText = scope.length ? ` (${scope.join(", ")})` : "";
  if (!results.length) {
    return `No Kagi results for "${query}"${scopeText}.`;
  }
  const lines: string[] = [];
  lines.push(`Kagi results for "${query}"${scopeText}:`);
  lines.push("");
  results.forEach((r, i) => {
    let head = `${i + 1}. ${r.title}`;
    if (r.group) head += `  [${r.group}]`;
    lines.push(head);
    lines.push(`   ${r.url}`);
    const meta = [r.time, r.snippet].filter(Boolean).join(" — ");
    if (meta) lines.push(`   ${meta}`);
  });
  if (clipped) {
    // Only suggest paging where it exists (web search) and stays within the schema cap.
    const pageHint = page && page < 10 ? ` or page=${page + 1}` : "";
    lines.push("");
    lines.push(`(showing ${results.length} of ${clipped} results — pass a higher limit${pageHint} for more)`);
  }
  if (related && related.length) {
    lines.push("");
    lines.push(`Related searches: ${related.join(" · ")}`);
  }
  return lines.join("\n");
}
