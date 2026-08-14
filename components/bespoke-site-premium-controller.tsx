"use client";

import { useEffect } from "react";
import {
  BESPOKE_SITE_UPSELL_EVENT,
  type BespokeSiteUpsellEventDetail,
} from "@/lib/bespoke-site-access";
import { storeLaunchPathPreset } from "@/lib/launch-paths";
import { requestWorkspaceOpen } from "@/lib/workspace-open-request";

const PREMIUM_BUTTON_LABEL = "PREMIUM · GENERATE BESPOKE AI SITE";
const PREMIUM_HINT =
  "A one-off original AI page built to the paid responsive design standard. Requires Bond + Pro Site, Pro, or Pro Bundle.";

function syncPremiumLabel(): void {
  const button = document.querySelector<HTMLButtonElement>(
    ".build-site-secondary-button",
  );
  if (button) {
    button.dataset.premiumLabel = PREMIUM_BUTTON_LABEL;
    button.setAttribute(
      "aria-label",
      "Premium: generate a bespoke AI site with a paid Hoodlums plan",
    );
  }

  const hint = document.querySelector<HTMLElement>(
    ".build-site-secondary-hint",
  );
  if (
    hint &&
    hint.dataset.bespokeUpsell !== "true" &&
    hint.textContent !== PREMIUM_HINT
  ) {
    hint.textContent = PREMIUM_HINT;
  }
}

export function BespokeSitePremiumController() {
  useEffect(() => {
    syncPremiumLabel();
    const observer = new MutationObserver(syncPremiumLabel);
    observer.observe(document.body, { childList: true, subtree: true });

    function onUpsell(event: Event) {
      const detail = (event as CustomEvent<BespokeSiteUpsellEventDetail>).detail;
      const message = detail?.message ||
        "Bespoke AI design requires Bond + Pro Site, Pro, or Pro Bundle. Your free site generator remains available.";
      const hint = document.querySelector<HTMLElement>(
        ".build-site-secondary-hint",
      );
      if (hint) {
        hint.dataset.bespokeUpsell = "true";
        hint.textContent = `${message} Opening secure checkout…`;
      }

      // The current project remains in place: changing its plan opens the
      // existing chooser, which consumes this preset and routes the paid path
      // into the shared, server-verified checkout from PR #314.
      storeLaunchPathPreset(detail?.checkoutPlan || "bond-pro-site");
      window.requestAnimationFrame(() => {
        const changePlan = document.querySelector<HTMLButtonElement>(
          ".change-plan-button",
        );
        if (changePlan) {
          changePlan.click();
          return;
        }
        requestWorkspaceOpen("new", "bond-pro-site");
      });
    }

    window.addEventListener(BESPOKE_SITE_UPSELL_EVENT, onUpsell);
    return () => {
      observer.disconnect();
      window.removeEventListener(BESPOKE_SITE_UPSELL_EVENT, onUpsell);
    };
  }, []);

  return (
    <style>{`
      .build-site-secondary-button {
        font-size: 0 !important;
      }
      .build-site-secondary-button::after {
        content: attr(data-premium-label);
        font: 800 9px "IBM Plex Mono", monospace;
        letter-spacing: .07em;
      }
      .build-site-secondary-button[aria-busy="true"]::after {
        content: "PREMIUM · GENERATING BESPOKE AI SITE…";
      }
      .build-site-secondary-hint::before {
        content: "PREMIUM ";
        color: #f1cf55;
        font-weight: 800;
        letter-spacing: .06em;
      }
    `}</style>
  );
}
