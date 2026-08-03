import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  LAUNCH_PATH_OPTIONS,
  consumeLaunchPathPreset,
  isLaunchPathLocked,
  launchPathLabel,
  storeLaunchPathPreset,
} from "@/lib/launch-paths";

const ROOT = process.cwd();

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

describe("launch path options", () => {
  it("defines the four approved paths in order", () => {
    expect(LAUNCH_PATH_OPTIONS.map((option) => option.id)).toEqual([
      "bond",
      "bond-site",
      "bond-pro-site",
      "pro",
    ]);
    expect(LAUNCH_PATH_OPTIONS.map((option) => option.name)).toEqual([
      "Bond",
      "Bond + Site",
      "Bond + Pro Site",
      "Pro",
    ]);
  });

  it("moves Recommended to Bond + Pro Site and labels Bond + Site Most Popular", () => {
    const bondSite = LAUNCH_PATH_OPTIONS.find((option) => option.id === "bond-site");
    const bondProSite = LAUNCH_PATH_OPTIONS.find((option) => option.id === "bond-pro-site");

    expect(bondSite?.badge).toBe("Most Popular");
    expect(bondSite?.featured).toBe(true);
    expect(bondProSite?.badge).toBe("Recommended");
    expect(bondProSite?.recommended).toBe(true);
    expect(LAUNCH_PATH_OPTIONS.filter((option) => option.recommended)).toHaveLength(1);
  });

  it("uses the approved USD pricing and Pro copy", () => {
    const [bond, bondSite, bondProSite, pro] = LAUNCH_PATH_OPTIONS;
    expect(bond.price).toBe("Free");
    expect(bondSite.price).toBe("Free");
    expect(bondProSite.price).toBe("$10 · one-off");
    expect(pro.price).toBe("$50/month · per token");
    expect(pro.tagline).toBe(
      "Your token's marketing, on autopilot. Whatever chain you're on.",
    );
    expect(pro.bullets).toContain("Works for any token — any chain");
    expect(pro.detailsLink?.targetId).toBe("pro-bundle");
  });

  it("looks up a display label by id and falls back to an empty string", () => {
    expect(launchPathLabel("bond")).toBe("Bond");
    expect(launchPathLabel("bond-site")).toBe("Bond + Site");
    expect(launchPathLabel("bond-pro-site")).toBe("Bond + Pro Site");
    expect(launchPathLabel("pro")).toBe("Pro");
    expect(launchPathLabel(null)).toBe("");
    expect(launchPathLabel(undefined)).toBe("");
  });

  it("stores a homepage preset once and clears it after the chooser consumes it", () => {
    const storage = memoryStorage();
    storeLaunchPathPreset("bond-pro-site", storage);
    expect(consumeLaunchPathPreset(storage)).toBe("bond-pro-site");
    expect(consumeLaunchPathPreset(storage)).toBeNull();
  });
});

describe("token path chooser overlay", () => {
  it("stores the chosen path on the token project so it's available at launch", async () => {
    const types = await readFile(path.join(ROOT, "lib", "types.ts"), "utf8");
    expect(types).toContain(
      'export type LaunchPath = "bond" | "bond-site" | "bond-pro-site" | "pro";',
    );
    expect(types).toContain("launchPath?: LaunchPath | null;");
  });

  it("renders an X that dismisses the overlay into a choose-plan prompt", async () => {
    const component = await readFile(
      path.join(ROOT, "components", "token-path-chooser.tsx"),
      "utf8",
    );

    expect(component).toContain("if (!open) return null;");
    expect(component).toContain('role="dialog"');
    expect(component).toContain('aria-label="Close plan chooser"');
    expect(component).toContain("onClick={() => setDismissed(true)}");
    expect(component).toContain("Choose a plan to continue");
    expect(component).toContain("onClick={() => setDismissed(false)}");
  });

  it("keeps an unplanned project locked even after the overlay is dismissed", () => {
    expect(isLaunchPathLocked(false, null)).toBe(true);
    expect(isLaunchPathLocked(false, undefined)).toBe(true);
    expect(isLaunchPathLocked(false, "bond")).toBe(false);
    expect(isLaunchPathLocked(true, "bond")).toBe(true);
  });

  it("highlights the clicked column and dims the others, with approved badges", async () => {
    const component = await readFile(
      path.join(ROOT, "components", "token-path-chooser.tsx"),
      "utf8",
    );

    expect(component).toContain("const isSelected = pending === option.id;");
    expect(component).toContain("onClick={() => setPending(option.id)}");
    expect(component).toContain("isSelected ? styles.columnSelected : \"\"");
    expect(component).toContain("pending && !isSelected ? styles.columnDimmed : \"\"");
    expect(component).toContain("option.badge ? <span className={styles.badge}>{option.badge}</span>");
  });

  it("only shows Continue once a column is selected, and confirms the pending selection", async () => {
    const component = await readFile(
      path.join(ROOT, "components", "token-path-chooser.tsx"),
      "utf8",
    );

    expect(component).toContain("{pending ? (");
    expect(component).toContain("onClick={() => onConfirm(pending)}");
  });

  it("consumes a homepage CTA preset whenever a new chooser opens", async () => {
    const component = await readFile(
      path.join(ROOT, "components", "token-path-chooser.tsx"),
      "utf8",
    );

    expect(component).toContain("setPending(consumeLaunchPathPreset() ?? selected);");
    expect(component).toContain("OPEN_WORKSPACE_REQUEST_EVENT");
    expect(component).toContain("setPending(launchPath);");
  });

  it("links both the overlay footer and Pro Bundle copy to the homepage plans anchors", async () => {
    const component = await readFile(
      path.join(ROOT, "components", "token-path-chooser.tsx"),
      "utf8",
    );

    expect(component).toContain("See full plan details ↓");
    expect(component).toContain('targetId = "plans"');
    expect(component).toContain("viewPlanDetails(detailsLink.targetId)");
    expect(component).toContain("scrollIntoView");
  });

  it("stacks the four columns on mobile and switches to a row on wider screens", async () => {
    const css = await readFile(
      path.join(ROOT, "components", "token-path-chooser.module.css"),
      "utf8",
    );

    expect(css).toContain(".columns {\n  display: grid;\n  grid-template-columns: 1fr;");
    expect(css).toContain("@media (min-width: 1000px)");
    expect(css).toContain("grid-template-columns: repeat(4, 1fr);");
  });
});

describe("token studio path-chooser wiring", () => {
  it("opens the chooser whenever a new project starts", async () => {
    const studio = await readFile(path.join(ROOT, "components", "token-studio.tsx"), "utf8");

    expect(studio).toContain("const [showPathChooser, setShowPathChooser] = useState(false);");
    expect(studio).toContain("function startNewProject() {");
    expect(studio).toMatch(/function startNewProject\(\) \{[^}]*setShowPathChooser\(true\);/s);
  });

  it("confirming a path stores it on the project and closes the overlay", async () => {
    const studio = await readFile(path.join(ROOT, "components", "token-studio.tsx"), "utf8");

    expect(studio).toContain("function confirmLaunchPath(path: LaunchPath) {");
    expect(studio).toContain('updateProject("launchPath", path);');
    expect(studio).toMatch(
      /function confirmLaunchPath\(path: LaunchPath\) \{[^}]*setShowPathChooser\(false\);/s,
    );
  });

  it("Change plan reopens the overlay without clearing the existing selection", async () => {
    const studio = await readFile(path.join(ROOT, "components", "token-studio.tsx"), "utf8");

    expect(studio).toContain("function changeLaunchPath() {");
    expect(studio).toMatch(/function changeLaunchPath\(\) \{\s*setShowPathChooser\(true\);\s*\}/);
    expect(studio).toContain("onClick={changeLaunchPath}");
    expect(studio).toContain("selected={project.launchPath ?? null}");
    expect(studio).toContain("onConfirm={confirmLaunchPath}");
  });

  it("keeps the form and topbar inert while the chooser remains logically open", async () => {
    const studio = await readFile(path.join(ROOT, "components", "token-studio.tsx"), "utf8");
    const css = await readFile(path.join(ROOT, "app", "globals.css"), "utf8");

    expect(studio).toContain(
      'className={showPathChooser ? "builder-panel path-locked" : "builder-panel"}',
    );
    expect(studio).toContain("aria-disabled={showPathChooser || undefined}");
    expect(studio).toContain("inert={showPathChooser || undefined}");
    expect(studio).toContain('<header className="topbar" inert={showPathChooser || undefined}>');
    expect(css).toContain(".builder-panel.path-locked {");
    expect(css).toContain("filter: saturate(.35) brightness(.5);");
    expect(css).toContain("pointer-events: none;");
  });
});
