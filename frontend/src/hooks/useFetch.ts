import { useEffect, useState } from "react";

interface FetchState<T> {
  loading: boolean;
  data: T | null;
  error: Error | null;
}

/**
 * No cache, no revalidation - re-runs whenever a dependency in `deps` changes.
 * `data`/`error` are plain nullable fields rather than a discriminated union
 * so callers can narrow `data` with a direct `if (data)` after destructuring.
 */
export function useFetch<T>(load: () => Promise<T>, deps: unknown[]): FetchState<T> {
  const [state, setState] = useState<FetchState<T>>({
    loading: true,
    data: null,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, data: null, error: null });
    load().then(
      (data) => {
        if (!cancelled) setState({ loading: false, data, error: null });
      },
      (error: Error) => {
        if (!cancelled) setState({ loading: false, data: null, error });
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
