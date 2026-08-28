"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Reports whether the returned ref's node is scrolled near the viewport,
 * following components/hoodlums-social-showcase.tsx's existing
 * IntersectionObserver pattern (SSR/unsupported-browser guard, disconnect on
 * unmount). Used by the homepage grid's per-card sparkline (issue #436) so a
 * card off screen never fetches or polls its trade history. `rootMargin` is
 * generous enough that a card just below the fold is already warm by the
 * time it's scrolled into view.
 */
export function useInView<T extends Element>(rootMargin = "200px") {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof IntersectionObserver === "undefined") return;
    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), {
      threshold: 0,
      rootMargin,
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [rootMargin]);

  return { ref, inView };
}
