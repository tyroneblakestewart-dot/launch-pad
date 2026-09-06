// Which Token setup fields a plan actually needs (owner direction, 6 Sep
// 2026: "this field should change depending what user wants — just token
// launch, or free launch and site, or paid — so it's less confusing").
//
//   bond           → the token only: no website path, no site sections, no
//                    generator of either kind.
//   bond-site      → the free artwork-matched site: website path, the free
//                    site sections picker and the free generator.
//   bond-pro-site  → the paid bespoke site: website path and the bespoke
//                    generator; the free sections picker and free generator
//                    are hidden. (The inspiration website URL was removed by
//                    owner decision, 6 Sep 2026.)
//   pro/pro-bundle → Social Studio subscriptions buy no website (6 Sep
//                    decision), so a token created under them gets the free
//                    site set, exactly like bond-site.
//   no plan yet    → everything, as before, until the chooser decides.
//
// Pure and client-safe; the studio (React) and the Build 02 gate (DOM) both
// read it, so the two can never disagree about what is on screen.

import type { LaunchPath } from "@/lib/types";

export type StudioFieldPlan = {
  /** The hoodlums.dev/<slug> field. */
  websitePath: boolean;
  /** The "Free site sections" checkboxes. */
  freeSiteSections: boolean;
  /** GENERATE SITE FROM ARTWORK (the free template). */
  freeGenerator: boolean;
  /** Generate a bespoke AI site (paid). */
  bespokeGenerator: boolean;
};

export const STUDIO_FIELD_PLAN_ATTRIBUTE = "data-launch-path";

const EVERYTHING: StudioFieldPlan = {
  websitePath: true,
  freeSiteSections: true,
  freeGenerator: true,
  bespokeGenerator: true,
};

const TOKEN_ONLY: StudioFieldPlan = {
  websitePath: false,
  freeSiteSections: false,
  freeGenerator: false,
  bespokeGenerator: false,
};

const FREE_SITE: StudioFieldPlan = {
  websitePath: true,
  freeSiteSections: true,
  freeGenerator: true,
  bespokeGenerator: false,
};

const PAID_SITE: StudioFieldPlan = {
  websitePath: true,
  freeSiteSections: false,
  freeGenerator: false,
  bespokeGenerator: true,
};

export function studioFieldsForLaunchPath(path: LaunchPath | string | null | undefined): StudioFieldPlan {
  switch (path) {
    case "bond":
      return TOKEN_ONLY;
    case "bond-site":
    case "pro":
    case "pro-bundle":
      return FREE_SITE;
    case "bond-pro-site":
      return PAID_SITE;
    default:
      return EVERYTHING;
  }
}

/** True when the plan offers any website generator, so Build 02 has a reason to exist. */
export function offersWebsiteBuild(fields: StudioFieldPlan): boolean {
  return fields.freeGenerator || fields.bespokeGenerator;
}
