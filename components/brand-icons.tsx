import type { SVGProps } from "react";

/**
 * Official X mark — kept in sync with public/logos/x.svg. This is the one
 * source of truth for the X brand mark; do not re-inline this path elsewhere.
 */
export function XMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 251 256" aria-hidden="true" fill="currentColor" {...props}>
      <path d="M149.079 108.399L242.33 0h-22.098l-80.97 94.12L74.59 0H0l97.796 142.328L0 256h22.1l85.507-99.395L175.905 256h74.59L149.073 108.399zM118.81 143.58l-9.909-14.172l-78.84-112.773h33.943l63.625 91.011l9.909 14.173l82.705 118.3H186.3l-67.49-96.533z" />
    </svg>
  );
}

/**
 * Official Telegram mark — the path is kept in sync with public/logos/telegram.svg
 * and is the one source of truth; do not re-inline it elsewhere. Rendered in
 * Telegram's own brand colours (a #2AABEE → #229ED9 disc with a white plane)
 * rather than currentColor, because a brand mark keeps its colours wherever it
 * sits — a lime toggle or a grey row must not recolour it.
 */
export function TelegramMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <defs>
        <linearGradient id="hoodlums-telegram-brand" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2AABEE" />
          <stop offset="1" stopColor="#229ED9" />
        </linearGradient>
      </defs>
      <circle cx="12" cy="12" r="12" fill="#fff" />
      <path
        fill="url(#hoodlums-telegram-brand)"
        d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.831-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"
      />
    </svg>
  );
}
