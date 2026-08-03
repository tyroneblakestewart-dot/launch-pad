import type { TradeTerminalLink } from "@/lib/trade-terminal-links";
import styles from "./token-page.module.css";

const TERMINAL_NOTES: Record<string, string> = {
  gmgn: "ref · hoodlums",
  axiom: "ref · hoodlums",
  maestro: "telegram bot",
  ave: "ref · hoodlums",
};

/**
 * Right column of the public token page (issue #225): referral-coded
 * "Trade on" links and a static about/story panel. Purely presentational (no
 * wallet or live data), so this stays a plain server component with no
 * client directive. There's no stored description for an arbitrary
 * chain/address token page (private drafts live in the browser, published
 * sites are keyed by slug, not address — see CLAUDE.md), so the about panel
 * shows a plain fallback line instead of inventing copy. Live token chat now
 * lives in the centre column's Hoodchat tab (issue #237), replacing the
 * "coming soon" placeholder that used to sit here.
 */
export function TokenRightColumn({ tradeLinks }: { tradeLinks: TradeTerminalLink[] }) {
  return (
    <>
      <div className={styles.panel}>
        <span className={styles.sectionLabel}>Trade on</span>
        {tradeLinks.length === 0 ? (
          <p className={styles.mutedNote}>No trade terminals are available for this chain yet.</p>
        ) : (
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
        )}
      </div>

      <div className={styles.panel}>
        <span className={styles.sectionLabel}>About</span>
        <p className={styles.storyText}>No description has been published for this token yet.</p>
        <div className={styles.storyTags}>
          <span className={styles.storyTag}>Bonding curve testnet launch</span>
        </div>
      </div>
    </>
  );
}
