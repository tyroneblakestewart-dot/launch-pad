import styles from "./account.module.css";

type ProviderName = "Google" | "GitHub" | "X" | "MetaMask" | "Rabby" | "Phantom";

const webAccounts: { name: ProviderName; note: string }[] = [
  { name: "Google", note: "Email and project sync" },
  { name: "GitHub", note: "Developer account" },
  { name: "X", note: "Social identity" },
];

const wallets: { name: ProviderName; note: string }[] = [
  { name: "MetaMask", note: "EVM wallet" },
  { name: "Rabby", note: "EVM wallet" },
  { name: "Phantom", note: "Solana and EVM wallet" },
];

function ProviderLogo({ name }: { name: ProviderName }) {
  if (name === "Google") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.8 3-4.3 3-7.3Z" />
        <path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.5L15.4 17c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.2H3.1v2.6A10 10 0 0 0 12 22Z" />
        <path fill="#FBBC05" d="M6.4 13.8A6 6 0 0 1 6.1 12c0-.6.1-1.2.3-1.8V7.6H3.1A10 10 0 0 0 2 12c0 1.6.4 3.1 1.1 4.4l3.3-2.6Z" />
        <path fill="#EA4335" d="M12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.8A9.7 9.7 0 0 0 12 2a10 10 0 0 0-8.9 5.6l3.3 2.6C7.2 7.8 9.4 6 12 6Z" />
      </svg>
    );
  }

  if (name === "GitHub") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d="M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.9c-2.8.6-3.4-1.2-3.4-1.2-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 0 1.6 1 1.6 1 .9 1.6 2.4 1.1 2.9.9.1-.7.4-1.1.7-1.3-2.3-.3-4.6-1.1-4.6-5a3.9 3.9 0 0 1 1-2.7 3.6 3.6 0 0 1 .1-2.7s.9-.3 2.8 1a9.7 9.7 0 0 1 5.1 0c2-1.3 2.8-1 2.8-1 .6 1.4.2 2.4.1 2.7a3.9 3.9 0 0 1 1 2.7c0 3.9-2.4 4.7-4.6 5 .4.3.7 1 .7 2V21c0 .3.2.6.7.5A10 10 0 0 0 12 2Z" />
      </svg>
    );
  }

  if (name === "X") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d="M18.3 3H21l-5.9 6.7L22 21h-5.4l-4.2-5.5L7.6 21H5l6.2-7.1L4.6 3H10l3.8 5 4.5-5Zm-.9 16h1.5L9.2 4.9H7.6L17.4 19Z" />
      </svg>
    );
  }

  if (name === "MetaMask") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#E2761B" d="m20.5 3-7.3 5.4 1.3-3.2L20.5 3ZM3.5 3l7.2 5.5-1.2-3.3L3.5 3Z" />
        <path fill="#E4761B" d="m17.9 15.7-1.9 2.9 4.1 1.1 1.2-4-3.4 0ZM2.7 15.7l1.2 4 4.1-1.1-1.9-2.9H2.7Z" />
        <path fill="#D7C1B3" d="m7.8 10.8-1.1 1.7 4 .2-.1-4.3-2.8 2.4ZM16.2 10.8l-2.9-2.5-.1 4.4 4-.2-1-1.7Z" />
        <path fill="#233447" d="m8 18.6 2.5-1.2-2.2-1.7-.3 2.9ZM13.5 17.4l2.5 1.2-.3-2.9-2.2 1.7Z" />
        <path fill="#CD6116" d="m16 18.6-2.5-1.2.2 1.6v.7l2.3-1.1ZM8 18.6l2.4 1.1V19l.1-1.6L8 18.6Z" />
        <path fill="#E4751F" d="m10.5 14.6-2.1-.6 1.5.7.6-.1ZM13.5 14.6l.6.1 1.5-.7-2.1.6Z" />
        <path fill="#F6851B" d="m8 18.6.3-2.9-2.2.1L8 18.6ZM15.7 15.7l.3 2.9 1.9-2.8-2.2-.1ZM17.2 12.5l-4 .2.4 1.9.6.1 1.5-.7 1.5-1.5ZM8.4 14l1.5.7.6-.1.4-1.9-4-.2L8.4 14Z" />
        <path fill="#C0AD9E" d="m6.9 12.5 1.7 3.4-.1-1.9-1.6-1.5ZM15.6 14l-.1 1.9 1.7-3.4-1.6 1.5ZM10.9 12.7l-.4 1.9.5 2.6.1-3.4-.2-1.1ZM13.1 12.7l-.2 1.1.1 3.4.5-2.6-.4-1.9Z" />
        <path fill="#161616" d="m13.5 14.6-.5 2.6.4.2 2.2-1.7.1-1.9-2.2.8ZM8.4 13.8l.1 1.9 2.2 1.7.4-.2-.5-2.6-2.2-.8Z" />
        <path fill="#763D16" d="m13.7 19-.2-1.6-.4-.3h-2.2l-.4.3-.1 1.6-2.4-.4.8.7 2.1 1.4h2.2l2.1-1.4.8-.7-2.3.4Z" />
        <path fill="#F6851B" d="m13.2 8.4.3-3.2L20.5 3l-7.3 5.4ZM10.8 8.5 3.5 3l7 2.2.3 3.3Z" />
      </svg>
    );
  }

  if (name === "Rabby") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#8697FF" d="M4 8.2C4 5.3 6.3 3 9.2 3h5.6C17.7 3 20 5.3 20 8.2v7.6c0 2.9-2.3 5.2-5.2 5.2H9.2A5.2 5.2 0 0 1 4 15.8V8.2Z" />
        <path fill="#fff" d="M8.2 8.3h7.1c1.4 0 2.5 1.1 2.5 2.5v2.4c0 1.4-1.1 2.5-2.5 2.5h-2.1l-1.5 2-1.4-2H8.2a2.5 2.5 0 0 1-2.5-2.5v-2.4c0-1.4 1.1-2.5 2.5-2.5Z" />
        <circle cx="9.3" cy="12" r="1" fill="#30374F" />
        <circle cx="14.2" cy="12" r="1" fill="#30374F" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id="phantom-gradient" x1="4" y1="3" x2="20" y2="21" gradientUnits="userSpaceOnUse">
          <stop stopColor="#9B6CFF" />
          <stop offset="1" stopColor="#5A36E8" />
        </linearGradient>
      </defs>
      <path fill="url(#phantom-gradient)" d="M12 2C6.5 2 2 6.2 2 11.4c0 4 2.7 7.5 6.5 8.8.6.2 1.2-.1 1.4-.7l.6-1.8c.2-.6.9-.8 1.4-.5l1.7 1.1c.5.3 1.1.3 1.5-.1 4.1-3.1 6.9-7.7 6.9-12.2C22 3.8 18.7 2 14.7 2H12Z" />
      <circle cx="9" cy="10.5" r="1.2" fill="#fff" />
      <circle cx="14.5" cy="10.5" r="1.2" fill="#fff" />
      <path stroke="#fff" strokeWidth="1.5" strokeLinecap="round" d="M8.5 14c1.9 1.1 4.6 1.1 6.5 0" />
    </svg>
  );
}

export default function AccountPage() {
  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="account-title">
        <header className={styles.header}>
          <p>ACCOUNT</p>
          <h1 id="account-title">Choose how you sign in.</h1>
          <span>
            Your account will eventually keep projects available across devices. No sign-in
            provider is active in this first layout release.
          </span>
        </header>

        <section className={styles.group} aria-labelledby="web-accounts-title">
          <div className={styles.groupHeading}>
            <h2 id="web-accounts-title">Continue with</h2>
            <small>Web accounts</small>
          </div>
          <div className={styles.options}>
            {webAccounts.map((account) => (
              <button key={account.name} type="button" disabled>
                <span className={`${styles.mark} ${styles[account.name.toLowerCase()]}`}>
                  <ProviderLogo name={account.name} />
                </span>
                <span><b>{account.name}</b><small>{account.note}</small></span>
                <em>Coming next</em>
              </button>
            ))}
          </div>
        </section>

        <div className={styles.divider}><span>OR USE A WALLET</span></div>

        <section className={styles.group} aria-labelledby="wallet-accounts-title">
          <div className={styles.groupHeading}>
            <h2 id="wallet-accounts-title">Connect a wallet</h2>
            <small>Web3 accounts</small>
          </div>
          <div className={styles.options}>
            {wallets.map((wallet) => (
              <button key={wallet.name} type="button" disabled>
                <span className={`${styles.mark} ${styles[wallet.name.toLowerCase()]}`}>
                  <ProviderLogo name={wallet.name} />
                </span>
                <span><b>{wallet.name}</b><small>{wallet.note}</small></span>
                <em>Coming next</em>
              </button>
            ))}
          </div>
        </section>

        <footer className={styles.footer}>
          Existing wallet connections inside the launch tools remain unchanged while this
          account system is built safely in separate steps.
        </footer>
      </section>
    </main>
  );
}
