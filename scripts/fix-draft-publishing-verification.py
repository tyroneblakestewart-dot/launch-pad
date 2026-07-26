from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def patch(path: str, old: str, new: str) -> None:
    target = ROOT / path
    content = target.read_text()
    if old not in content:
        raise SystemExit(f"Expected block missing from {path}: {old[:100]!r}")
    target.write_text(content.replace(old, new, 1))


patch(
    "components/full-website-generator.tsx",
    '''type RenderedPreview = {
  container: HTMLElement;
  frame: HTMLIFrameElement;
  controlCleanups: Array<() => void>;
};''',
    '''type RenderedPreview = {
  container: HTMLElement;
  frame: HTMLIFrameElement;
  closeButton: HTMLButtonElement;
  fullScreenButton: HTMLButtonElement;
  onClose: () => void;
  onToggleFullScreen: () => void;
  controlCleanups: Array<() => void>;
};''',
)
patch(
    "components/full-website-generator.tsx",
    '''function disposeRenderedPreview(preview: RenderedPreview | null) {
  if (!preview) return;
  for (const cleanup of preview.controlCleanups) cleanup();
  preview.container.classList.remove("full-generated-page-fullscreen");
  disposeFrame(preview.frame);
  preview.container.remove();
}''',
    '''function disposeRenderedPreview(preview: RenderedPreview | null) {
  if (!preview) return;
  preview.closeButton.removeEventListener("click", preview.onClose);
  preview.fullScreenButton.removeEventListener("click", preview.onToggleFullScreen);
  for (const cleanup of preview.controlCleanups) cleanup();
  preview.container.classList.remove("full-generated-page-fullscreen");
  disposeFrame(preview.frame);
  preview.container.remove();
}''',
)
patch(
    "components/full-website-generator.tsx",
    '''  listen(publishButton, () => { void onPublishDraft(); });
  listen(fullScreenButton, onToggleFullScreen);
  listen(closeButton, onClose);
  controls.append(publishStatus, publishButton, fullScreenButton, closeButton);''',
    '''  listen(publishButton, () => { void onPublishDraft(); });
  fullScreenButton.addEventListener("click", onToggleFullScreen);
  closeButton.addEventListener("click", onClose);
  controls.append(publishStatus, publishButton, fullScreenButton, closeButton);''',
)
patch(
    "components/full-website-generator.tsx",
    '''  return { container, frame, controlCleanups };''',
    '''  return {
    container,
    frame,
    closeButton,
    fullScreenButton,
    onClose,
    onToggleFullScreen,
    controlCleanups,
  };''',
)
patch(
    "tests/draft-publishing.test.ts",
    '''  async publishWithChallenge(
    _input: PublishWithChallengeInput,
    _verifySignature: PublishSignatureVerifier,
  ): Promise<PublishStoreResult> {
    throw new Error("Not used by visibility tests");
  }''',
    '''  async publishWithChallenge(): Promise<PublishStoreResult> {
    throw new Error("Not used by visibility tests");
  }''',
)
patch(
    "tests/draft-publishing.test.ts",
    '''    expect(generator).toContain('viewDraftButton.addEventListener("click"');''',
    '''    expect(generator).toContain("listen(viewDraftButton, onViewDraft);");''',
)

print("Preview teardown guards preserved.")
