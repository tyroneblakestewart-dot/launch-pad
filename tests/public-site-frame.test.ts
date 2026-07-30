import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PublicSiteFrame } from "@/components/public-site-frame";

const SOURCE = readFileSync(
  path.join(process.cwd(), "components", "public-site-frame.tsx"),
  "utf8",
);

describe("PublicSiteFrame source", () => {
  it("is a plain server component with no client directive or hooks", () => {
    expect(SOURCE).not.toContain("use client");
    expect(SOURCE).not.toContain("useState");
    expect(SOURCE).not.toContain("useRef");
    expect(SOURCE).not.toContain("useEffect");
  });

  it("registers no window message listener", () => {
    expect(SOURCE).not.toContain("addEventListener");
    expect(SOURCE).not.toContain("hoodlums-generated-page-height");
  });
});

describe("PublicSiteFrame render", () => {
  it("renders a sandboxed iframe that keeps sandbox, srcDoc, and fills the viewport with CSS", () => {
    const html = "<!doctype html><html><body>hi</body></html>";
    const element = PublicSiteFrame({ html });

    expect(element.type).toBe("iframe");
    expect(element.props.sandbox).toBe("allow-scripts allow-popups");
    expect(element.props.referrerPolicy).toBe("no-referrer");
    expect(element.props.loading).toBe("eager");
    expect(element.props.srcDoc).toBe(html);
    expect(element.props.style).toMatchObject({ width: "100%", height: "100svh" });
  });

  it("grants allow-popups (so link-outs work) but never allow-same-origin (the generated page stays opaque-origin)", () => {
    const element = PublicSiteFrame({ html: "<!doctype html><html><body>hi</body></html>" });
    const tokens = (element.props.sandbox as string).split(/\s+/);

    expect(tokens).toContain("allow-popups");
    expect(tokens).not.toContain("allow-same-origin");
  });
});

describe("studio preview path", () => {
  const STUDIO_SOURCE = readFileSync(
    path.join(process.cwd(), "components", "full-website-generator.tsx"),
    "utf8",
  );

  it("is unchanged: still a client component with its own height-bridge listener", () => {
    expect(STUDIO_SOURCE).toContain('"use client"');
    expect(STUDIO_SOURCE).toContain("hoodlums-generated-page-height");
    expect(STUDIO_SOURCE).toContain("addEventListener");
  });
});
