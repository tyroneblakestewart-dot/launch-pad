"use client";

import { useEffect, useRef, useState } from "react";

const MIN_HEIGHT = 700;
const MAX_HEIGHT = 16_000;
const DEFAULT_HEIGHT = 900;

/**
 * Renders the saved standalone generated page HTML in a sandboxed iframe
 * and tracks its height through the same `hoodlums-generated-page-height`
 * postMessage bridge that `prepareGeneratedPageForPreview` already injects
 * for the studio preview.
 */
export function PublicSiteFrame({ html }: { html: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!frameRef.current || event.source !== frameRef.current.contentWindow) return;
      const data = event.data as { type?: unknown; height?: unknown };
      if (data?.type !== "hoodlums-generated-page-height") return;
      const value = typeof data.height === "number" ? data.height : Number(data.height);
      if (!Number.isFinite(value)) return;
      setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.ceil(value))));
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <iframe
      ref={frameRef}
      title="Generated token landing page"
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      loading="eager"
      srcDoc={html}
      style={{ display: "block", width: "100%", height, border: 0, background: "#fff" }}
    />
  );
}
