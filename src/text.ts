/** Escapes text for HTML, attributes included. null and undefined become ''. The Worker keeps its own copy. */
export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]!);

/** True when s starts with http:// or https:// (any case). */
export const isHttpUrl = (s: string) => /^https?:\/\//i.test(s);
