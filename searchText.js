// Türkçe İ/I ve @ öneki gibi arama tuzaklarını düzeltir.

/** Baştaki @ ve fazla boşlukları temizler. */
export function normalizeSearchQuery(raw) {
  let q = String(raw ?? "").trim();
  if (q.startsWith("@")) q = q.slice(1).trim();
  return q;
}

/**
 * Karşılaştırma için katlama:
 * - TR locale (İ→i, I→ı)
 * - birleşik aksanları ayırıp sök
 */
export function foldSearchText(raw) {
  return String(raw ?? "")
    .toLocaleLowerCase("tr")
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

/** needle, haystack içinde mi (TR-aware, @ yok sayılır). */
export function searchIncludes(haystack, needle) {
  const n = foldSearchText(normalizeSearchQuery(needle));
  if (!n) return true;
  return foldSearchText(haystack).includes(n);
}

/** PostgREST/Postgres ilike jokerlerini kaçır. */
export function escapeIlike(raw) {
  return String(raw ?? "").replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}
