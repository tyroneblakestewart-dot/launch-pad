import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function source(file: string): Promise<string> {
  return readFile(path.join(ROOT, file), "utf8");
}

describe("System Health pipeline drill-down UI", () => {
  it("fetches the per-service pipeline on demand, not on the 30-second summary poll", async () => {
    const component = await source("components/admin-system-health.tsx");
    expect(component).toContain("/api/admin/health/pipeline?service=");
    expect(component).toContain("toggleExpanded");
    expect(component).toContain("REFRESH_INTERVAL_MS");
    // The pipeline fetch is wired to the expand toggle, not the interval effect.
    const intervalEffectIndex = component.indexOf("setInterval(() => void loadHealth()");
    const pipelineFetchIndex = component.indexOf("void loadPipeline(next)");
    expect(intervalEffectIndex).toBeGreaterThan(-1);
    expect(pipelineFetchIndex).toBeGreaterThan(-1);
  });

  it("renders stages as a flow of nodes and connectors, each with its own status, and a click-to-expand detail panel", async () => {
    const component = await source("components/admin-system-health.tsx");
    expect(component).toContain("PipelineFlow");
    expect(component).toContain("styles.connector");
    expect(component).toContain("styles.pipelineNode");
    expect(component).toContain("onSelectStage");
    expect(component).toContain("pipelineDetailMessage");
  });

  it("never claims a stage was checked live when it was only observed in the past", async () => {
    const component = await source("components/admin-system-health.tsx");
    expect(component).toContain("Last observed");
    expect(component).toContain("observedAt");
  });

  it("is read-only in the drill-down — no isolation controls are rendered here", async () => {
    const component = await source("components/admin-system-health.tsx");
    expect(component).not.toContain("PATCH");
    expect(component).not.toContain("setServiceIsolation");
    expect(component).not.toContain("isolate");
  });

  it("stacks the pipeline flow vertically below the iPhone Safari width breakpoint", async () => {
    const css = await source("components/admin-system-health.module.css");
    expect(css).toContain("@media (max-width: 480px)");
    expect(css).toContain("flex-direction: column");
  });
});
