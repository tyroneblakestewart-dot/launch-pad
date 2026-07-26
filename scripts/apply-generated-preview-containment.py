from pathlib import Path

component = Path("components/full-website-generator.tsx")
text = component.read_text()

options_anchor = '''type RequestGeneratedWebsiteOptions = {
  signal?: AbortSignal;
  onProgress?: (stage: GenerateSitePageProgressStage) => void;
};
'''
options_replacement = options_anchor + '''
type RenderedPreview = {
  container: HTMLElement;
  frame: HTMLIFrameElement;
  closeButton: HTMLButtonElement;
  fullScreenButton: HTMLButtonElement;
  onClose: () => void;
  onToggleFullScreen: () => void;
};

const MOBILE_PREVIEW_QUERY = "(max-width: 767px)";
export const MOBILE_PREVIEW_HEIGHT = "70svh";

export function getGeneratedPreviewFrameHeight(reportedHeight: number, mobile: boolean): string {
  if (mobile) return MOBILE_PREVIEW_HEIGHT;
  return `${Math.min(16_000, Math.max(700, Math.ceil(reportedHeight)))}px`;
}
'''
if options_anchor not in text:
    raise SystemExit("Request options anchor was not found")
text = text.replace(options_anchor, options_replacement, 1)

helper_start = text.index("function disposeFrame")
helper_end = text.index("\n\nexport function FullWebsiteGenerator()", helper_start)
helper_block = '''function disposeFrame(frame: HTMLIFrameElement | null) {
  if (!frame) return;
  frame.srcdoc = "";
  frame.remove();
}

function disposeRenderedPreview(preview: RenderedPreview | null) {
  if (!preview) return;
  preview.closeButton.removeEventListener("click", preview.onClose);
  preview.fullScreenButton.removeEventListener("click", preview.onToggleFullScreen);
  preview.container.classList.remove("full-generated-page-fullscreen");
  disposeFrame(preview.frame);
  preview.container.remove();
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function isMobilePreviewViewport(): boolean {
  return window.matchMedia(MOBILE_PREVIEW_QUERY).matches;
}

function applyGeneratedPreviewHeight(frame: HTMLIFrameElement, reportedHeight: number) {
  frame.style.height = getGeneratedPreviewFrameHeight(reportedHeight, isMobilePreviewViewport());
}

function renderGeneratedWebsite(
  html: string,
  artworkDataUrl: string,
  onClosePreview: () => void,
): RenderedPreview {
  const site = previewElement();
  const prepared = prepareGeneratedPageForPreview(html, artworkDataUrl);
  clearPreviewStatus(site);

  const container = document.createElement("section");
  container.className = "full-generated-page-container";
  container.setAttribute("aria-label", "Generated website preview");

  const controls = document.createElement("div");
  controls.className = "full-generated-page-controls";

  const fullScreenButton = document.createElement("button");
  fullScreenButton.type = "button";
  fullScreenButton.className = "full-generated-page-fullscreen-button";
  fullScreenButton.textContent = "Full screen";
  fullScreenButton.setAttribute("aria-pressed", "false");

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "full-generated-page-close-button";
  closeButton.textContent = "Close preview";

  const viewport = document.createElement("div");
  viewport.className = "full-generated-page-viewport";

  const frame = document.createElement("iframe");
  frame.className = "full-generated-page-frame";
  frame.title = "Generated token landing page";
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.setAttribute("loading", "eager");
  frame.setAttribute("scrolling", "yes");
  applyGeneratedPreviewHeight(frame, 1800);
  frame.srcdoc = prepared;

  const onToggleFullScreen = () => {
    const fullScreen = container.classList.toggle("full-generated-page-fullscreen");
    fullScreenButton.textContent = fullScreen ? "Exit full screen" : "Full screen";
    fullScreenButton.setAttribute("aria-pressed", String(fullScreen));
  };
  const onClose = () => onClosePreview();

  fullScreenButton.addEventListener("click", onToggleFullScreen);
  closeButton.addEventListener("click", onClose);
  controls.append(fullScreenButton, closeButton);
  viewport.appendChild(frame);
  container.append(controls, viewport);

  site.classList.add("full-generated-page");
  site.appendChild(container);

  return {
    container,
    frame,
    closeButton,
    fullScreenButton,
    onClose,
    onToggleFullScreen,
  };
}
'''
text = text[:helper_start] + helper_block + text[helper_end:]

function_start = text.index("export function FullWebsiteGenerator()")
function_tail = '''export function FullWebsiteGenerator() {
  useEffect(() => {
    let activePreview: RenderedPreview | null = null;
    let activeController: AbortController | null = null;
    let generationNumber = 0;
    let lastReportedHeight = 1800;

    function restoreStudioControls() {
      const site = document.querySelector<HTMLElement>(".site-preview");
      disposeRenderedPreview(activePreview);
      activePreview = null;
      if (site) {
        clearPreviewStatus(site);
        site.classList.remove("full-generated-page");
      }
    }

    function applyActiveFrameHeight() {
      if (!activePreview) return;
      applyGeneratedPreviewHeight(activePreview.frame, lastReportedHeight);
    }

    function onMessage(event: MessageEvent) {
      if (!activePreview || event.source !== activePreview.frame.contentWindow) return;
      const data = event.data as { type?: unknown; height?: unknown };
      if (data?.type !== "hoodlums-generated-page-height") return;
      const height = typeof data.height === "number" ? data.height : Number(data.height);
      if (!Number.isFinite(height)) return;
      lastReportedHeight = height;
      applyActiveFrameHeight();
    }

    function onViewportResize() {
      applyActiveFrameHeight();
    }

    async function onGenerate(event: Event) {
      const detail = (event as CustomEvent<GenerateDetail>).detail;
      const currentGeneration = ++generationNumber;
      activeController?.abort();
      restoreStudioControls();
      lastReportedHeight = 1800;
      const controller = new AbortController();
      activeController = controller;
      const hasInspiration = Boolean(detail.inspirationUrl);
      setPreviewStatus(
        "generating",
        stageMessage("analysing-artwork", hasInspiration),
        STAGE_HEADLINES["analysing-artwork"],
      );

      try {
        const page = await requestGeneratedWebsite(detail, {
          signal: controller.signal,
          onProgress: (stage) => {
            if (currentGeneration !== generationNumber) return;
            setPreviewStatus("generating", stageMessage(stage, hasInspiration), STAGE_HEADLINES[stage]);
          },
        });
        if (currentGeneration !== generationNumber) return;
        activePreview = renderGeneratedWebsite(page.html, detail.imageDataUrl || "", () => {
          generationNumber += 1;
          activeController?.abort();
          activeController = null;
          restoreStudioControls();
        });
        applyActiveFrameHeight();
        window.dispatchEvent(
          new CustomEvent("launchpad:site-generated", {
            detail: {
              style: { source: "openai", inspirationUsed: page.inspirationUsed },
              fullPage: true,
              html: page.html,
            },
          }),
        );
      } catch (error) {
        if (currentGeneration !== generationNumber || isAbortError(error)) return;
        const message =
          error instanceof Error ? error.message : "The full website could not be generated.";
        setPreviewStatus(
          "failed",
          `${message} The terminal-style base preview has not been accepted as your generated website.`,
        );
        window.dispatchEvent(
          new CustomEvent("launchpad:site-generation-failed", {
            detail: {
              message,
              previewAvailable: false,
            },
          }),
        );
      } finally {
        if (activeController === controller) activeController = null;
      }
    }

    window.addEventListener("message", onMessage);
    window.addEventListener("resize", onViewportResize);
    window.addEventListener("launchpad:generate-site", onGenerate);
    return () => {
      generationNumber += 1;
      activeController?.abort();
      activeController = null;
      window.removeEventListener("message", onMessage);
      window.removeEventListener("resize", onViewportResize);
      window.removeEventListener("launchpad:generate-site", onGenerate);
      restoreStudioControls();
    };
  }, []);

  return (
    <style>{`
      .site-preview.full-generated-page {
        min-height: 760px;
        overflow: hidden;
        border-radius: 12px;
        background: #fff;
      }
      .site-preview.full-generated-page::after { display: none; }
      .site-preview.full-generated-page > :not(.full-generated-page-container):not(.full-generated-page-status) { display: none !important; }
      .full-generated-page-container {
        width: 100%;
        overflow: hidden;
        background: #fff;
      }
      .full-generated-page-controls {
        position: sticky;
        top: 0;
        z-index: 3;
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        min-height: 52px;
        padding: 8px 10px;
        border-bottom: 1px solid rgba(19, 37, 54, .14);
        background: rgba(248, 251, 253, .96);
        backdrop-filter: blur(12px);
      }
      .full-generated-page-controls button {
        min-height: 36px;
        padding: 0 14px;
        border: 1px solid rgba(49, 95, 123, .28);
        border-radius: 8px;
        background: #fff;
        color: #183448;
        font: 800 12px/1 system-ui, sans-serif;
      }
      .full-generated-page-controls button:focus-visible {
        outline: 3px solid rgba(49, 95, 123, .28);
        outline-offset: 2px;
      }
      .full-generated-page-close-button {
        background: #183448 !important;
        color: #fff !important;
      }
      .full-generated-page-viewport {
        width: 100%;
        overflow: auto;
        overscroll-behavior: contain;
        -webkit-overflow-scrolling: touch;
        background: #fff;
      }
      .full-generated-page-frame {
        display: block;
        width: 100%;
        min-height: 760px;
        border: 0;
        background: #fff;
        overflow: auto;
        touch-action: pan-x pan-y;
      }
      .full-generated-page-container.full-generated-page-fullscreen {
        position: fixed;
        inset: 0;
        z-index: 2147483000;
        display: grid;
        grid-template-rows: auto minmax(0, 1fr);
        width: 100vw;
        height: 100svh;
        max-width: none;
        border-radius: 0;
        background: #fff;
      }
      .full-generated-page-fullscreen .full-generated-page-controls { position: relative; }
      .full-generated-page-fullscreen .full-generated-page-viewport {
        min-height: 0;
        height: 100%;
      }
      .full-generated-page-fullscreen .full-generated-page-frame {
        height: 100% !important;
        min-height: 0;
        max-height: none;
      }
      .site-preview.full-page-generating,
      .site-preview.full-page-failed {
        position: relative;
        min-height: 700px;
        overflow: hidden;
        background: #f4f6f8;
      }
      .site-preview.full-page-generating > :not(.full-generated-page-status),
      .site-preview.full-page-failed > :not(.full-generated-page-status) {
        display: none !important;
      }
      .full-generated-page-status {
        min-height: 700px;
        display: grid;
        align-content: center;
        justify-items: center;
        gap: 14px;
        padding: 48px 24px;
        text-align: center;
        color: #132536;
        background:
          radial-gradient(circle at 20% 15%, rgba(91, 177, 214, .22), transparent 34%),
          linear-gradient(155deg, #f8fbfd, #edf3f6);
      }
      .full-generated-page-status span {
        color: #315f7b;
        font: 800 11px/1.2 system-ui, sans-serif;
        letter-spacing: .14em;
      }
      .full-generated-page-status strong {
        max-width: 680px;
        font: 800 clamp(28px, 6vw, 52px)/1.02 system-ui, sans-serif;
      }
      .full-generated-page-status p {
        max-width: 680px;
        margin: 0;
        color: #526878;
        font: 500 16px/1.65 system-ui, sans-serif;
      }
      .site-preview.full-page-generating .full-generated-page-status::after {
        width: 42px;
        height: 42px;
        content: "";
        border: 4px solid rgba(49, 95, 123, .18);
        border-top-color: #315f7b;
        border-radius: 50%;
        animation: hoodlums-page-spin .8s linear infinite;
      }
      .site-preview.full-page-failed .full-generated-page-status {
        background: linear-gradient(155deg, #fff8f6, #f7ece8);
      }
      .site-preview.full-page-failed .full-generated-page-status span { color: #a13b29; }
      @keyframes hoodlums-page-spin { to { transform: rotate(360deg); } }
      @media (max-width: 767px) {
        .site-preview.full-generated-page {
          min-height: 0;
          overflow: visible;
        }
        .full-generated-page-container:not(.full-generated-page-fullscreen) {
          max-height: calc(70svh + 52px);
        }
        .full-generated-page-controls {
          justify-content: stretch;
          padding: 8px;
        }
        .full-generated-page-controls button { flex: 1 1 0; }
        .full-generated-page-container:not(.full-generated-page-fullscreen) .full-generated-page-viewport {
          height: 70svh;
          max-height: 70svh;
        }
        .full-generated-page-container:not(.full-generated-page-fullscreen) .full-generated-page-frame {
          height: 70svh !important;
          min-height: 0;
          max-height: 70svh;
        }
        .site-preview.full-page-generating,
        .site-preview.full-page-failed,
        .full-generated-page-status { min-height: 700px; }
      }
    `}</style>
  );
}
'''
text = text[:function_start] + function_tail
component.write_text(text)
