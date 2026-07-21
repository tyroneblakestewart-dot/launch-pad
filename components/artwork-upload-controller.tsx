"use client";

import { useEffect } from "react";
import {
  ARTWORK_COMPRESSION_STEPS,
  fitArtworkDimensions,
  type ArtworkCompressionStep,
} from "@/lib/artwork-compression";
import styles from "./artwork-upload-controller.module.css";

const EXISTING_UPLOAD_LIMIT = 1_500_000;
const MAX_SOURCE_BYTES = 20_000_000;
const TARGET_BYTES = 1_250_000;
const UPLOAD_HELP =
  "PNG, JPG, WEBP, GIF or AVIF · up to 20 MB · large files auto-optimised";

function isArtworkInput(target: EventTarget | null): target is HTMLInputElement {
  return (
    target instanceof HTMLInputElement &&
    target.type === "file" &&
    Boolean(target.closest(".upload-box"))
  );
}

function isLikelyImage(file: File): boolean {
  return (
    file.type.startsWith("image/") ||
    /\.(png|jpe?g|webp|gif|avif|bmp|heic|heif)$/i.test(file.name)
  );
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(bytes >= 10_000_000 ? 0 : 1)} MB`;
}

function getUploadBox(input?: HTMLInputElement | null): HTMLElement | null {
  return (input?.closest(".upload-box") as HTMLElement | null) ||
    (document.querySelector(".upload-box") as HTMLElement | null);
}

function ensureStatus(box: HTMLElement): HTMLElement {
  let status = box.querySelector<HTMLElement>(".artwork-upload-status");
  if (!status) {
    status = document.createElement("span");
    status.className = "artwork-upload-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    box.appendChild(status);
  }
  return status;
}

function setStatus(
  message: string,
  state: "idle" | "working" | "success" | "error",
  input?: HTMLInputElement | null,
) {
  const box = getUploadBox(input);
  if (!box) return;
  const status = ensureStatus(box);
  status.textContent = message;
  status.dataset.state = state;
}

function refreshUploadCopy() {
  const box = getUploadBox();
  if (!box) return;

  const help = box.querySelector<HTMLElement>("small");
  if (help && help.textContent !== UPLOAD_HELP) {
    help.textContent = UPLOAD_HELP;
  }
  ensureStatus(box);
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(
        new Error(
          "This image format could not be opened by the browser. Convert it to PNG, JPG or WEBP and try again.",
        ),
      );
    };
    image.src = objectUrl;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function encodeArtwork(
  image: HTMLImageElement,
  step: ArtworkCompressionStep,
  type: "image/webp" | "image/jpeg",
): Promise<Blob | null> {
  const { width, height } = fitArtworkDimensions(
    image.naturalWidth,
    image.naturalHeight,
    step.maxDimension,
  );
  const opaque = type === "image/jpeg";
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d", { alpha: !opaque });
  if (!context) throw new Error("The browser could not prepare the image canvas.");

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  if (opaque) {
    context.fillStyle = "#050706";
    context.fillRect(0, 0, width, height);
  }
  context.drawImage(image, 0, 0, width, height);

  return canvasToBlob(canvas, type, step.quality);
}

function optimisedExtension(blob: Blob): "webp" | "jpg" | "png" {
  if (blob.type === "image/jpeg") return "jpg";
  if (blob.type === "image/png") return "png";
  return "webp";
}

function makeOptimisedFile(source: File, blob: Blob): File {
  const baseName = source.name.replace(/\.[^.]+$/, "") || "token-artwork";
  const extension = optimisedExtension(blob);
  return new File([blob], `${baseName}-optimised.${extension}`, {
    type: blob.type || (extension === "jpg" ? "image/jpeg" : `image/${extension}`),
    lastModified: Date.now(),
  });
}

async function optimiseArtwork(file: File): Promise<File> {
  const image = await loadImage(file);
  const sourceWidth = image.naturalWidth;
  const sourceHeight = image.naturalHeight;

  if (!sourceWidth || !sourceHeight) {
    throw new Error("The selected image has no readable dimensions.");
  }

  let smallestBlob: Blob | null = null;

  for (const type of ["image/webp", "image/jpeg"] as const) {
    for (const step of ARTWORK_COMPRESSION_STEPS) {
      const blob = await encodeArtwork(image, step, type);
      if (!blob) continue;
      if (!smallestBlob || blob.size < smallestBlob.size) smallestBlob = blob;
      if (blob.size <= TARGET_BYTES) return makeOptimisedFile(file, blob);
    }
  }

  if (smallestBlob && smallestBlob.size <= EXISTING_UPLOAD_LIMIT) {
    return makeOptimisedFile(file, smallestBlob);
  }

  throw new Error(
    "This browser could not shrink the artwork enough. Export it as a JPG or WEBP at 3000 px or less and try again.",
  );
}

export function ArtworkUploadController() {
  useEffect(() => {
    refreshUploadCopy();

    const observer = new MutationObserver(refreshUploadCopy);
    observer.observe(document.body, { childList: true, subtree: true });

    function handleClick(event: MouseEvent) {
      if (!isArtworkInput(event.target)) return;
      // Allows the same file to be selected again after an error or replacement.
      event.target.value = "";
      setStatus("Choose artwork from your device.", "idle", event.target);
    }

    async function handleChange(event: Event) {
      if (!isArtworkInput(event.target)) return;
      const input = event.target;

      if (input.dataset.optimisedArtwork === "true") {
        delete input.dataset.optimisedArtwork;
        return;
      }

      const file = input.files?.[0];
      if (!file) return;

      if (!isLikelyImage(file)) {
        setStatus("That file is not a supported image.", "error", input);
        return;
      }

      if (file.size > MAX_SOURCE_BYTES) {
        event.preventDefault();
        event.stopImmediatePropagation();
        input.value = "";
        setStatus(
          `That file is ${formatMegabytes(file.size)}. Choose an image below 20 MB.`,
          "error",
          input,
        );
        return;
      }

      if (file.size <= EXISTING_UPLOAD_LIMIT) {
        setStatus(`Uploading ${file.name}…`, "working", input);
        window.setTimeout(() => {
          setStatus(`Artwork loaded · ${formatMegabytes(file.size)}`, "success", input);
        }, 250);
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
      setStatus(
        `Optimising ${file.name} (${formatMegabytes(file.size)})…`,
        "working",
        input,
      );

      try {
        const optimisedFile = await optimiseArtwork(file);
        const transfer = new DataTransfer();
        transfer.items.add(optimisedFile);
        input.files = transfer.files;
        input.dataset.optimisedArtwork = "true";
        setStatus(
          `Artwork optimised to ${formatMegabytes(optimisedFile.size)} and loaded.`,
          "success",
          input,
        );
        input.dispatchEvent(new Event("change", { bubbles: true }));
      } catch (error) {
        input.value = "";
        setStatus(
          error instanceof Error ? error.message : "The artwork could not be uploaded.",
          "error",
          input,
        );
      }
    }

    document.addEventListener("click", handleClick, true);
    document.addEventListener("change", handleChange, true);

    return () => {
      observer.disconnect();
      document.removeEventListener("click", handleClick, true);
      document.removeEventListener("change", handleChange, true);
    };
  }, []);

  return <span className={styles.mount} aria-hidden="true" />;
}
