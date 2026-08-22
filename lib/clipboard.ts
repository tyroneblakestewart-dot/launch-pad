/**
 * Copies text to the clipboard via the async Clipboard API, falling back to
 * a hidden textarea + execCommand("copy") when it's unavailable (e.g. an
 * insecure context or a browser without navigator.clipboard). Never throws —
 * callers get an honest boolean instead, so a failed copy shows an error
 * state rather than silently doing nothing.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy fallback below.
  }

  try {
    if (typeof document === "undefined") return false;
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    let appended = false;
    try {
      document.body.appendChild(textarea);
      appended = true;
      textarea.select();
      return document.execCommand("copy");
    } finally {
      // Removed even if select()/execCommand above throws, so a broken
      // browser implementation never leaves the hidden textarea behind.
      if (appended) {
        try {
          document.body.removeChild(textarea);
        } catch {
          // Best-effort — nothing more to do if removal itself throws.
        }
      }
    }
  } catch {
    return false;
  }
}
