/**
 * Renders the saved standalone generated page HTML in a sandboxed iframe.
 * Published pages are fully server-rendered: the sanitiser strips every
 * `<script>` from the stored HTML, so there is no client JavaScript here and
 * no height-reporting bridge to listen for. The iframe fills the viewport
 * with CSS instead.
 */
export function PublicSiteFrame({ html }: { html: string }) {
  return (
    <iframe
      title="Generated token landing page"
      sandbox="allow-scripts allow-popups"
      referrerPolicy="no-referrer"
      loading="eager"
      srcDoc={html}
      style={{ display: "block", width: "100%", height: "100svh", border: 0, background: "#fff" }}
    />
  );
}
