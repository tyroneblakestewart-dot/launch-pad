/* eslint-disable @next/next/no-img-element */
import styles from "./account.module.css";

type ProviderName = "Google" | "GitHub" | "X" | "MetaMask" | "Rabby" | "Phantom";

const METAMASK_LOGO = "data:image/webp;base64,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";
const RABBY_LOGO = "data:image/webp;base64,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";

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
    return <img src={METAMASK_LOGO} alt="" />;
  }

  if (name === "Rabby") {
    return <img src={RABBY_LOGO} alt="" />;
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
