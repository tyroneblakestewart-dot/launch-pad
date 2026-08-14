import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  LAUNCH_PATH_OPTIONS,
  PLAN_CHOOSER_OPTIONS,
  PRO_BUNDLE_OPTION,
  consumeLaunchPathPreset,
  hasLaunchPathPreset,
  isLaunchPathLocked,
  launchPathLabel,
  readLaunchPathPreset,
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
  it("keeps the four homepage cards and defines five chooser paths in lifecycle order", () => {
    expect(LAUNCH_PATH_OPTIONS.map((option) => option.id)).toEqual([
      "bond",
      "bond-site",
      "bond-pro-site",
      "pro",
    ]);
    expect(PLAN_CHOOSER_OPTIONS.map((option) => option.id)).toEqual([
      "bond",
      "bond-site",
      "bond-pro-site",
      "pro",
      "pro-bundle",
    ]);
    expect(PRO_BUNDLE_OPTION).toMatchObject({
      name: "Pro Bundle",
      price: "$120/month · up to 3 tokens",
      tagline: "Run your whole portfolio. One dashboard. One payment.",
    });
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
  });

  it("looks up all five display labels", () => {
    expect(launchPathLabel("bond")).toBe("Bond");
    expect(launchPathLabel("bond-site")).toBe("Bond + Site");
    expect(launchPathLabel("bond-pro-site")).toBe("Bond + Pro Site");
    expect(launchPathLabel("pro")).toBe("Pro");
    expect(launchPathLabel("pro-bundle")).toBe("Pro Bundle");
    expect(launchPathLabel(null)).toBe("");
  });

  it("can inspect a stored preset without consuming it, then consumes it once", () => {
    const storage = memoryStorage();
    storeLaunchPathPreset("pro-bundle", storage);

    expect(hasLaunchPathPreset(storage)).toBe(true);
    expect(readLaunchPathPreset(storage)).toBe("pro-bundle");
    expect(readLaunchPathPreset(storage)).toBe("pro-bundle");
    expect(consumeLaunchPathPreset(storage)).toBe("pro-bundle");
    expect(hasLaunchPathPreset(storage)).toBe(false);
    expect(consumeLaunchPathPreset(storage)).toBeNull();
  });
});

describe("token path chooser overlay", () => {
  it("stores all five path ids on the token project type", async () => {
    const types = await readFile(path.join(ROOT, "lib", "types.ts"), "utf8");
    for (const pathId of ["bond", "bond-site", "bond-pro-site", "pro", "pro-bundle"]) {
      expect(types).toContain(`"${pathId}"`);
    }
    expect(types).toContain("launchPath?: LaunchPath | null;");
  });

  it("renders an X that dismisses the unplanned chooser into a choose-plan prompt", async () => {
    const component = await readFile(path.join(ROOT, "components", "token-path-chooser.tsx"), "utf8");
    expect(component).toContain("if (!open || presetToConfirm) return null;");
    expect(component).toContain('role="dialog"');
    expect(component).toContain('aria-label="Close plan chooser"');
    expect(component).toContain("Choose a plan to continue");
  });

  it("keeps an unplanned project locked even after the overlay is dismissed", () => {
    expect(isLaunchPathLocked(false, null)).toBe(true);
    expect(isLaunchPathLocked(false, undefined)).toBe(true);
    expect(isLaunchPathLocked(false, "bond")).toBe(false);
    expect(isLaunchPathLocked(true, "bond")).toBe(true);
  });

  it("renders all five cards and highlights the pending selection", async () => {
    const component = await readFile(path.join(ROOT, "components", "token-path-chooser.tsx"), "utf8");
    expect(component).toContain("PLAN_CHOOSER_OPTIONS.map");
    expect(component).toContain("const isSelected = pending === option.id;");
    expect(component).toContain("onClick={() => setPending(option.id)}");
    expect(component).toContain("styles.columnSelected");
    expect(component).toContain("styles.columnDimmed");
  });

  it("skips the cards when a plan preset already exists", async () => {
    const component = await readFile(path.join(ROOT, "components", "token-path-chooser.tsx"), "utf8");

    expect(component).toContain("const preset = consumeLaunchPathPreset();");
    expect(component).toContain("const nextSelection = preset ?? selected;");
    expect(component).toContain("if (nextSelection && isPaidLaunchPath(nextSelection))");
    expect(component).toContain("beginCheckout(nextSelection);");
    expect(component).toContain("setPresetToConfirm(preset && !isPaidLaunchPath(preset) ? preset : null);");
    expect(component).toContain("onConfirm(presetToConfirm);");
    expect(component).toContain("if (!open || presetToConfirm) return null;");
  });

  it("sends manually selected free plans to the builder and paid plans to the shared checkout", async () => {
    const component = await readFile(path.join(ROOT, "components", "token-path-chooser.tsx"), "utf8");
    expect(component).toContain("function continueWithPending()");
    expect(component).toContain("if (isPaidLaunchPath(pending))");
    expect(component).toContain("beginCheckout(pending)");
    expect(component).toContain("onConfirm(pending)");
    expect(component).toContain("<PlanCheckout");
    expect(component).toContain("onBuilderUnlocked={unlockPaidBuilder}");
  });

  it("never confirms a paid preset or saved path before a verified checkout response", async () => {
    const component = await readFile(path.join(ROOT, "components", "token-path-chooser.tsx"), "utf8");
    const openStart = component.indexOf("if (open !== wasOpen) {");
    const openEnd = component.indexOf("useEffect(() => {", openStart);
    const openBlock = component.slice(openStart, openEnd);

    expect(openBlock).toContain("beginCheckout(nextSelection);");
    expect(openBlock).not.toContain("onConfirm(nextSelection)");

    const unlockStart = component.indexOf("function unlockPaidBuilder(");
    const unlockEnd = component.indexOf("if (!open || presetToConfirm)", unlockStart);
    const unlockBlock = component.slice(unlockStart, unlockEnd);
    expect(unlockBlock).toContain("builderUnlockGuard.current.consume(");
    expect(unlockBlock).toContain("verification");
    expect(unlockBlock).toContain("checkoutPlan");
    expect(unlockBlock).toContain("onConfirm(verifiedPlan)");
    expect(unlockBlock.indexOf("builderUnlockGuard.current.consume(")).toBeLessThan(
      unlockBlock.indexOf("onConfirm(verifiedPlan)"),
    );
  });

  it("fits all five cards on one desktop row without introducing horizontal scrolling", async () => {
    const css = await readFile(path.join(ROOT, "components", "token-path-chooser.module.css"), "utf8");
    expect(css).toContain("width: min(1240px, 100%);");
    expect(css).toContain("grid-template-columns: repeat(5, minmax(0, 1fr));");
    expect(css).not.toContain("overflow-x: auto");
    expect(css).toContain("max-height: calc(100svh - 24px)");
  });
});

describe("token studio path-chooser wiring", () => {
  it("opens the chooser when New token starts without a preset", async () => {
    const studio = await readFile(path.join(ROOT, "components", "token-studio.tsx"), "utf8");
    expect(studio).toContain("const [showPathChooser, setShowPathChooser] = useState(false);");
    expect(studio).toMatch(/function startNewProject\(\) \{[^}]*setShowPathChooser\(true\);/s);
  });

  it("auto-opens the homepage workspace after a Manager card stores a preset", async () => {
    const workspace = await readFile(
      path.join(ROOT, "components", "token-studio-workspace.tsx"),
      "utf8",
    );
    const manager = await readFile(path.join(ROOT, "components", "manager-plans.tsx"), "utf8");

    expect(workspace).toContain("hasLaunchPathPreset()");
    expect(workspace).toContain('setPendingAction("new")');
    expect(workspace).toContain("setIsOpen(true)");
    expect(workspace).not.toContain("consumeLaunchPathPreset");
    expect(manager).toContain('storeLaunchPathPreset("pro")');
    expect(manager).toContain('storeLaunchPathPreset("pro-bundle")');
  });

  it("stores a confirmed path and closes selection or checkout", async () => {
    const studio = await readFile(path.join(ROOT, "components", "token-studio.tsx"), "utf8");
    expect(studio).toContain("function confirmLaunchPath(path: LaunchPath) {");
    expect(studio).toContain('updateProject("launchPath", path);');
    expect(studio).toContain("onConfirm={confirmLaunchPath}");
  });

  it("keeps the full workspace inert while selection or payment remains open", async () => {
    const studio = await readFile(path.join(ROOT, "components", "token-studio.tsx"), "utf8");
    const css = await readFile(path.join(ROOT, "app", "globals.css"), "utf8");
    expect(studio).toContain('className={showPathChooser ? "builder-panel path-locked" : "builder-panel"}');
    expect(studio).toContain("inert={showPathChooser || undefined}");

    const workspaceStart = studio.indexOf('className="workspace"');
    const workspaceEnd = studio.indexOf(">", workspaceStart);
    const workspaceOpeningTag = studio.slice(workspaceStart, workspaceEnd);
    expect(workspaceOpeningTag).toContain("aria-disabled={showPathChooser || undefined}");
    expect(workspaceOpeningTag).toContain("inert={showPathChooser || undefined}");

    expect(css).toContain(".builder-panel.path-locked {");
    expect(css).toContain("pointer-events: none;");
  });
});
