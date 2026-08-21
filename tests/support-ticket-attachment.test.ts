import { describe, expect, it } from "vitest";
import {
  MAX_SUPPORT_TICKET_ATTACHMENT_BYTES,
  supportTicketAttachmentErrorMessage,
  validateSupportTicketAttachment,
} from "@/lib/server/support-ticket-attachment";

// A real, minimal 1x1 transparent PNG so magic-byte-style decode tests exercise a genuinely valid image, not just a well-formed data: URL wrapper.
const VALID_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const VALID_PNG_DATA_URL = `data:image/png;base64,${VALID_PNG_BASE64}`;

function dataUrlOfSize(mimeType: string, byteLength: number): string {
  // Every 3 raw bytes -> 4 base64 chars with no padding when byteLength % 3 === 0.
  const bytes = Buffer.alloc(byteLength, 1);
  return `data:${mimeType};base64,${bytes.toString("base64")}`;
}

describe("validateSupportTicketAttachment", () => {
  it("accepts no attachment as 'empty', not an error", () => {
    expect(validateSupportTicketAttachment(undefined)).toEqual({ status: "empty" });
    expect(validateSupportTicketAttachment(null)).toEqual({ status: "empty" });
    expect(validateSupportTicketAttachment("")).toEqual({ status: "empty" });
    expect(validateSupportTicketAttachment("   ")).toEqual({ status: "empty" });
  });

  it("rejects a non-string value as invalid", () => {
    expect(validateSupportTicketAttachment(1234)).toEqual({ status: "invalid" });
    expect(validateSupportTicketAttachment({})).toEqual({ status: "invalid" });
  });

  it("accepts a valid PNG/JPEG/WEBP data URL", () => {
    expect(validateSupportTicketAttachment(VALID_PNG_DATA_URL)).toEqual({ status: "ok", dataUrl: VALID_PNG_DATA_URL });
    expect(validateSupportTicketAttachment(dataUrlOfSize("image/jpeg", 300)).status).toBe("ok");
    expect(validateSupportTicketAttachment(dataUrlOfSize("image/webp", 300)).status).toBe("ok");
  });

  it("rejects a malformed data URL", () => {
    expect(validateSupportTicketAttachment("not-a-data-url").status).toBe("invalid");
    expect(validateSupportTicketAttachment("data:image/png;base64,").status).toBe("invalid");
    expect(validateSupportTicketAttachment("data:text/plain;base64,aGVsbG8=").status).toBe("unsupported_type");
  });

  it("rejects image/svg+xml even though it's structurally a valid data URL — SVG can script (issue #398)", () => {
    const svgDataUrl = `data:image/svg+xml;base64,${Buffer.from("<svg onload=alert(1)></svg>").toString("base64")}`;
    expect(validateSupportTicketAttachment(svgDataUrl)).toEqual({ status: "unsupported_type" });
  });

  it("rejects any other unsupported mime type", () => {
    expect(validateSupportTicketAttachment(dataUrlOfSize("image/gif", 300)).status).toBe("unsupported_type");
  });

  it("rejects a decoded payload over the hard byte cap", () => {
    const oversized = dataUrlOfSize("image/png", MAX_SUPPORT_TICKET_ATTACHMENT_BYTES + 3);
    expect(validateSupportTicketAttachment(oversized)).toEqual({ status: "too_large" });
  });

  it("accepts a decoded payload right at the hard byte cap", () => {
    const atCap = dataUrlOfSize("image/png", MAX_SUPPORT_TICKET_ATTACHMENT_BYTES);
    expect(validateSupportTicketAttachment(atCap).status).toBe("ok");
  });

  it("rejects an absurdly long string before ever base64-decoding it", () => {
    const huge = `data:image/png;base64,${"A".repeat(50_000_000)}`;
    expect(validateSupportTicketAttachment(huge)).toEqual({ status: "too_large" });
  });
});

describe("supportTicketAttachmentErrorMessage", () => {
  it("names the problem in plain English for each rejection reason", () => {
    expect(supportTicketAttachmentErrorMessage("too_large")).toMatch(/too large/i);
    expect(supportTicketAttachmentErrorMessage("unsupported_type")).toMatch(/file type/i);
    expect(supportTicketAttachmentErrorMessage("invalid")).toMatch(/could not be read/i);
  });
});
