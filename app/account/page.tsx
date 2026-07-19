import styles from "./account.module.css";

const webAccounts = [
  { name: "Google", mark: "G", note: "Email and project sync" },
  { name: "GitHub", mark: "GH", note: "Developer account" },
  { name: "X", mark: "X", note: "Social identity" },
];

const wallets = [
  { name: "MetaMask", mark: "M", note: "EVM wallet" },
  { name: "Rabby", mark: "R", note: "EVM wallet" },
  { name: "Phantom", mark: "P", note: "Solana and EVM wallet" },
];

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
                <span className={styles.mark}>{account.mark}</span>
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
                <span className={styles.mark}>{wallet.mark}</span>
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
