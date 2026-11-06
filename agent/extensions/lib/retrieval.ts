export const PAGE_CHARS = 12000;

export function textPage(text: string, offset = 0, limit = PAGE_CHARS) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > text.length) throw new Error("Offset is past the end or invalid; restart at offset 0");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > PAGE_CHARS) throw new Error(`limit must be between 1 and ${PAGE_CHARS}`);
  const end = Math.min(text.length, offset + limit);
  return { text: text.slice(offset, end), offset, next_offset: end < text.length ? end : null, total_chars: text.length, complete: end === text.length };
}

/** Pages are plain text, not JSON-escaped and then truncated; structured callers see the same page. */
export function pageResult<T extends { offset: number; next_offset: number | null; total_chars: number; complete: boolean }>(data: T, text: string) {
  const metadata = { ...data } as Record<string, unknown>;
  delete metadata.body; delete metadata.text;
  return { content: [{ type: "text" as const, text: `${JSON.stringify(metadata)}\n\n${text}` }], details: data, structuredContent: data };
}

export function excerpt(text: string, query: string, size = 240) {
  const at = text.toLowerCase().indexOf(query.toLowerCase());
  const start = Math.max(0, at - Math.floor(size / 3));
  return `${start ? "…" : ""}${text.slice(start, start + size)}${start + size < text.length ? "…" : ""}`;
}
