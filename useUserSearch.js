import { useState, useEffect, useRef, useCallback } from "react";
import { searchApprovedUsers } from "../services/profiles";
import { normalizeSearchQuery } from "../lib/searchText";

// Onaylı kullanıcı arama: en az 2 karakter, ~350ms debounce, iptal edilebilir.
export function useUserSearch({ minChars = 2, debounceMs = 350 } = {}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const reqId = useRef(0);

  const clear = useCallback(() => {
    setQuery("");
    setResults([]);
    setError(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    const q = normalizeSearchQuery(query);
    if (q.length < minChars) {
      setResults([]);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    const myId = ++reqId.current;
    const t = setTimeout(async () => {
      try {
        const data = await searchApprovedUsers(q, 20);
        if (myId === reqId.current) setResults(data);
      } catch (e) {
        if (myId === reqId.current) setError(e?.message || "Arama başarısız.");
      } finally {
        if (myId === reqId.current) setLoading(false);
      }
    }, debounceMs);

    return () => clearTimeout(t);
  }, [query, minChars, debounceMs]);

  const active = normalizeSearchQuery(query).length >= minChars;

  return { query, setQuery, results, loading, error, active, clear };
}
