import type { TradeTerminalLink } from "@/lib/trade-terminal-links";
import styles from "./token-page.module.css";

const TERMINAL_NOTES: Record<string, string> = {
  gmgn: "ref · hoodlums",
  axiom: "ref · hoodlums",
  maestro: "telegram bot",
  ave: "ref · hoodlums",
};

/**
 * Referral-coded "Trade on" links and a static about/story panel (issue
 * #225). Purely presentational (no wallet or live data), so this stays a
 * plain server component with no client directive. There's no stored
 * description for an arbitrary chain/address token page (private drafts
 * live in the browser, published sites are keyed by slug, not address — see
 * CLAUDE.md), so the about panel shows a plain fallback line instead of
 * inventing copy. Live token chat now lives in the centre column's Hoodchat
 * tab (issue #237), replacing the "coming soon" placeholder that used to sit
 * here. `.terminalPanel`/`.aboutPanel` (issue #429) let
 * `token-page.module.css` place the identity card directly above the About
 * panel in the desktop right column, independent of this component's own
 * source order, without changing which text renders.
 */
export function TokenRightColumn({ tradeLinks }: { tradeLinks: TradeTerminalLink[] }) {
  return (
    <>
      {tradeLinks.length > 0 && (
        <div className={`${styles.panel} ${styles.terminalPanel}`}>
          <span className={styles.sectionLabel}>Trade on</span>
          <div className={styles.terminalGrid}>
            {tradeLinks.map((link) => (
              <a key={link.id} href={link.url} target="_blank" rel="noreferrer" className={styles.terminalCard}>
                <span className={styles.terminalMark}>{link.label.charAt(0)}</span>
                <span>
                  <span className={styles.terminalName}>{link.label}</span>
                  <br />
                  <span className={styles.terminalNote}>{TERMINAL_NOTES[link.id] || "trade terminal"}</span>
                </span>
              </a>
            ))}
          </div>
        </div>
      )}

      <div className={`${styles.panel} ${styles.aboutPanel}`}>
        <span className={styles.sectionLabel}>About</span>
        <p className={styles.storyText}>No description has been published for this token yet.</p>
        <div className={styles.storyTags}>
          <span className={styles.storyTag}>Bonding curve launch</span>
        </div>
      </div>
    </>
  );
}
