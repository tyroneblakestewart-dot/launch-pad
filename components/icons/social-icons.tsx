type SocialIconProps = { className?: string };

// Official X (Twitter) wordmark, matching the path already used for the
// generated free-site template's community links (docs/free-site-template-source.html),
// inset into a rounded black square to match the app-icon presentation the
// issue asked for.
export function XIcon({ className }: SocialIconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
      <rect width="24" height="24" rx="6" fill="#000" />
      <g transform="translate(4.8 4.8) scale(0.6)">
        <path
          fill="#fff"
          d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"
        />
      </g>
    </svg>
  );
}

// Official Telegram mark: a white circle backing plus the brand's own
// circle+paper-plane cutout path (also reused from
// docs/free-site-template-source.html) filled in Telegram blue, so the
// plane silhouette reads correctly on any page background.
export function TelegramIcon({ className }: SocialIconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="12" fill="#fff" />
      <path
        fill="#29A9EB"
        d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.446 1.394c-.14.14-.26.26-.53.26l.192-2.72 4.94-4.462c.215-.19-.047-.297-.332-.106l-6.107 3.845-2.63-.822c-.573-.18-.586-.573.121-.848l10.263-3.96c.478-.174.897.107.744.845z"
      />
    </svg>
  );
}
