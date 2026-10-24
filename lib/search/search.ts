/**
 * Plain-text search (spec §50): every query term must appear (case-insensitive) somewhere in a
 * document; a match in the title ranks first. Pure, so ranking is testable.
 */

export const MIN_QUERY_LENGTH = 2;
export const MAX_QUERY_LENGTH = 100;
const SNIPPET_RADIUS = 60;

export interface SearchDocument {
  readonly title: string;
  readonly text: string;
}

export function terms(query: string): string[] {
  return [...new Set(query.toLowerCase().split(/\s+/).filter((term) => term.length > 0))];
}

/** Null when the document doesn't match; otherwise a score (higher first). */
export function score(document: SearchDocument, queryTerms: readonly string[]): number | null {
  if (queryTerms.length === 0) return null;
  const title = document.title.toLowerCase();
  const text = document.text.toLowerCase();
  let total = 0;
  for (const term of queryTerms) {
    const inTitle = title.includes(term);
    if (!inTitle && !text.includes(term)) return null;
    total += inTitle ? 3 : 1;
  }
  return total;
}

/** A short excerpt around the first matching term, on word boundaries where possible. */
export function snippet(text: string, queryTerms: readonly string[]): string {
  const flat = text.replace(/[#*`|>_]+/g, " ").replace(/\s+/g, " ").trim();
  const lower = flat.toLowerCase();
  const at = Math.min(...queryTerms.map((term) => lower.indexOf(term)).filter((index) => index >= 0), Number.MAX_SAFE_INTEGER);
  if (at === Number.MAX_SAFE_INTEGER) return flat.slice(0, SNIPPET_RADIUS * 2);
  const start = Math.max(0, at - SNIPPET_RADIUS);
  const end = Math.min(flat.length, at + SNIPPET_RADIUS);
  return `${start > 0 ? "…" : ""}${flat.slice(start, end).trim()}${end < flat.length ? "…" : ""}`;
}
