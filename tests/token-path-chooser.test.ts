import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LAUNCH_PATH_OPTIONS, launchPathLabel } from "@/lib/launch-paths";

const ROOT = process.cwd();

describe("launch path options", () => {
  it("defines the four paths from the issue in order, with Bond + Site recommended", () => {
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
    expect(LAUNCH_PATH_OPTIONS.filter((option) => option.recommended)).toHaveLength(1);
    expect(LAUNCH_PATH_OPTIONS.find((option) => option.recommended)?.id).toBe("bond-site");
  });

  it("prices Bond and Bond + Site free, and marks the two paid tiers", () => {
    const [bond, bondSite, bondProSite, pro] = LAUNCH_PATH_OPTIONS;
    expect(bond.price).toBe("Free");
    expect(bondSite.price).toBe("Free");
    expect(bondProSite.price).toMatch(/\$10/);
    expect(pro.price).toMatch(/\$30\/month/);
  });

  it("looks up a display label by id and falls back to an empty string", () => {
    expect(launchPathLabel("bond")).toBe("Bond");
    expect(launchPathLabel("bond-site")).toBe("Bond + Site");
    expect(launchPathLabel("bond-pro-site")).toBe("Bond + Pro Site");
    expect(launchPathLabel("pro")).toBe("Pro");
    expect(launchPathLabel(null)).toBe("");
    expect(launchPathLabel(undefined)).toBe("");
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

  it("renders nothing until opened, and has no close button or click-outside dismissal", async () => {
    const component = await readFile(
      path.join(ROOT, "components", "token-path-chooser.tsx"),
      "utf8",
    );

    expect(component).toContain("if (!open) return null;");
    expect(component).toContain('role="dialog"');
    expect(component).toContain('aria-modal="true"');
    expect(component).not.toContain(">×</button>");
    expect(component).not.toContain("onClick={() => setOpen(false)}");
    expect(component).not.toContain("onClick={onClose}");
  });

  it("highlights the clicked column and dims the others, with a recommended badge", async () => {
    const component = await readFile(
      path.join(ROOT, "components", "token-path-chooser.tsx"),
      "utf8",
    );

    expect(component).toContain("const isSelected = pending === option.id;");
    expect(component).toContain("onClick={() => setPending(option.id)}");
    expect(component).toContain("isSelected ? styles.columnSelected : \"\"");
    expect(component).toContain("pending && !isSelected ? styles.columnDimmed : \"\"");
    expect(component).toContain("option.recommended && <span className={styles.badge}>Recommended</span>");
  });

  it("only shows Continue once a column is selected, and confirms the pending selection", async () => {
    const component = await readFile(
      path.join(ROOT, "components", "token-path-chooser.tsx"),
      "utf8",
    );

    expect(component).toContain("{pending && (");
    expect(component).toContain("onClick={() => onConfirm(pending)}");
  });

  it("resets the pending highlight to the current selection whenever it reopens", async () => {
    const component = await readFile(
      path.join(ROOT, "components", "token-path-chooser.tsx"),
      "utf8",
    );

    expect(component).toContain("const [pending, setPending] = useState<LaunchPath | null>(selected);");
    expect(component).toContain("if (open !== wasOpen) {");
    expect(component).toContain("if (open) setPending(selected);");
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

  it("shows the current plan and a Change plan control once a path is chosen", async () => {
    const studio = await readFile(path.join(ROOT, "components", "token-studio.tsx"), "utf8");

    expect(studio).toContain("{project.launchPath && (");
    expect(studio).toContain("Plan: {launchPathLabel(project.launchPath)}");
    expect(studio).toContain("Change plan");
  });

  it("greys out and aria-disables the form while the chooser is open, not just pointer-events", async () => {
    const studio = await readFile(path.join(ROOT, "components", "token-studio.tsx"), "utf8");
    const css = await readFile(path.join(ROOT, "app", "globals.css"), "utf8");

    expect(studio).toContain(
      'className={showPathChooser ? "builder-panel path-locked" : "builder-panel"}',
    );
    expect(studio).toContain("aria-disabled={showPathChooser || undefined}");
    expect(studio).toContain("inert={showPathChooser || undefined}");
    expect(css).toContain(".builder-panel.path-locked {");
    expect(css).toContain("filter: saturate(.35) brightness(.5);");
    expect(css).toContain("pointer-events: none;");
  });

  it("also makes the topbar inert while the chooser is open, so keyboard/AT users can't tab behind it", async () => {
    const studio = await readFile(path.join(ROOT, "components", "token-studio.tsx"), "utf8");

    expect(studio).toContain('<header className="topbar" inert={showPathChooser || undefined}>');
  });

  it("renders the TokenPathChooser wired to the studio's own project state", async () => {
    const studio = await readFile(path.join(ROOT, "components", "token-studio.tsx"), "utf8");

    expect(studio).toContain('import { TokenPathChooser } from "./token-path-chooser";');
    expect(studio).toContain("<TokenPathChooser");
    expect(studio).toContain("open={showPathChooser}");
  });
});
