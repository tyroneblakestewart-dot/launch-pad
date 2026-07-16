"use client";

import Link from "next/link";
import { useState } from "react";
import { createPublicClient, createWalletClient, custom, defineChain, type Address } from "viem";
import { FIXED_SUPPLY_TOKEN_ABI, FIXED_SUPPLY_TOKEN_BYTECODE } from "@/lib/evm-token-artifact";
import styles from "./testnet-launcher.module.css";

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] | Record<string, unknown> }) => Promise<unknown>;
};

type LaunchResult = { address: string; transaction: string; explorerUrl: string };

const CHAIN_ID = 10143;
const CHAIN_ID_HEX = "0x279f";
const RPC_URL = "https://testnet-rpc.monad.xyz";
const EXPLORER_URL = "https://testnet.monadexplorer.com";

const monadTestnet = defineChain({
  id: CHAIN_ID,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: "Monad Testnet Explorer", url: EXPLORER_URL } },
  testnet: true,
});

function getEthereumProvider(): EthereumProvider | undefined {
  const browserWindow = window as unknown as {
    ethereum?: EthereumProvider;
    __launchpadEthereum?: EthereumProvider;
  };
  return browserWindow.__launchpadEthereum || browserWindow.ethereum;
}

function readError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "shortMessage" in error) {
    return String((error as { shortMessage: unknown }).shortMessage);
  }
  if (typeof error === "object" && error && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "The transaction failed.";
}

function shortAddress(value: string): string {
  return value.length > 18 ? `${value.slice(0, 9)}…${value.slice(-7)}` : value;
}

export function MonadTestnetLauncher() {
  const [name, setName] = useState("Hoodlums Monad Test");
  const [symbol, setSymbol] = useState("HOODMON");
  const [supply, setSupply] = useState("1000000000");
  const [decimals, setDecimals] = useState(18);
  const [wallet, setWallet] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(
    "Use Monad test funds only. Mainnet deployment is unavailable on this page.",
  );
  const [result, setResult] = useState<LaunchResult | null>(null);

  const valid =
    name.trim().length >= 2 &&
    name.trim().length <= 32 &&
    /^[A-Za-z0-9]{2,12}$/.test(symbol.trim()) &&
    /^\d+$/.test(supply) &&
    BigInt(supply || "0") > 0n &&
    decimals >= 0 &&
    decimals <= 18 &&
    confirmed;

  async function switchToMonad(provider: EthereumProvider) {
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: CHAIN_ID_HEX }],
      });
    } catch (switchError) {
      if ((switchError as { code?: number })?.code !== 4902) throw switchError;
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: CHAIN_ID_HEX,
          chainName: "Monad Testnet",
          nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
          rpcUrls: [RPC_URL],
          blockExplorerUrls: [EXPLORER_URL],
        }],
      });
    }
  }

  async function connectWallet() {
    setBusy(true);
    setResult(null);
    try {
      const provider = getEthereumProvider();
      if (!provider) throw new Error("Install or enable an EVM wallet first.");
      await switchToMonad(provider);
      const liveChain = String(await provider.request({ method: "eth_chainId" })).toLowerCase();
      if (liveChain !== CHAIN_ID_HEX) throw new Error(`Wrong network. Expected Monad Testnet chain ${CHAIN_ID}.`);
      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
      if (!accounts[0]) throw new Error("No EVM account was returned.");
      setWallet(accounts[0]);
      setStatus(`Monad Testnet connected · chain ${CHAIN_ID}.`);
    } catch (error) {
      setStatus(readError(error));
    } finally {
      setBusy(false);
    }
  }

  async function deploy() {
    if (!valid || !wallet) {
      setStatus("Complete the form, connect a wallet and confirm the testnet warning.");
      return;
    }
    setBusy(true);
    setResult(null);
    setStatus("Waiting for your wallet signature…");
    try {
      const provider = getEthereumProvider();
      if (!provider) throw new Error("EVM wallet disconnected.");
      const liveChain = String(await provider.request({ method: "eth_chainId" })).toLowerCase();
      if (liveChain !== CHAIN_ID_HEX) throw new Error(`Deployment blocked: switch to Monad Testnet (${CHAIN_ID}).`);

      const transport = custom(provider);
      const walletClient = createWalletClient({ chain: monadTestnet, transport });
      const publicClient = createPublicClient({ chain: monadTestnet, transport });
      const [account] = await walletClient.getAddresses();
      if (!account) throw new Error("No connected EVM account.");

      const transaction = await walletClient.deployContract({
        account,
        abi: FIXED_SUPPLY_TOKEN_ABI,
        bytecode: FIXED_SUPPLY_TOKEN_BYTECODE,
        args: [name.trim(), symbol.trim().toUpperCase(), BigInt(supply), decimals, account as Address],
      });
      setStatus(`Deployment submitted: ${shortAddress(transaction)}`);
      const receipt = await publicClient.waitForTransactionReceipt({ hash: transaction });
      if (!receipt.contractAddress) throw new Error("Receipt did not contain a contract address.");

      setResult({
        address: receipt.contractAddress,
        transaction,
        explorerUrl: `${EXPLORER_URL}/address/${receipt.contractAddress}`,
      });
      setStatus("Monad test token created successfully.");
    } catch (error) {
      setStatus(readError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <Link href="/">← Back to studio</Link>
        <span>MONAD TESTNET ONLY</span>
      </header>

      <section className={styles.content}>
        <div className={styles.intro}>
          <p>MONAD SAFE-MODE LAB</p>
          <h1>Launch fast.<br />Test safely.</h1>
          <p className={styles.lead}>
            Deploy a fixed-supply ERC-20 test token on Monad Testnet using your selected EVM wallet.
            The app never receives or stores your private key.
          </p>
        </div>

        <div className={styles.card}>
          <div className={styles.networkPicker}>
            <button className={styles.active} type="button">
              <i className={styles.solanaDot} /> Monad Testnet · 10143
            </button>
            <a href="https://faucet.monad.xyz" target="_blank" rel="noreferrer">Get test MON ↗</a>
          </div>

          <div className={styles.grid}>
            <label><span>Token name</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={32} /></label>
            <label><span>Ticker</span><input value={symbol} onChange={(event) => setSymbol(event.target.value.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12))} /></label>
            <label><span>Whole-token supply</span><input value={supply} inputMode="numeric" onChange={(event) => setSupply(event.target.value.replace(/\D/g, ""))} /></label>
            <label><span>Decimals</span><input type="number" min={0} max={18} value={decimals} onChange={(event) => setDecimals(Number(event.target.value))} /></label>
          </div>

          <button className={styles.walletButton} onClick={connectWallet} disabled={busy}>
            {wallet ? `Wallet: ${shortAddress(wallet)}` : "Connect EVM wallet"}
          </button>

          <label className={styles.confirmation}>
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            <span>I understand this deploys a real testnet contract, spends test MON for gas and does not create liquidity or a public sale.</span>
          </label>

          <button className={styles.deployButton} onClick={deploy} disabled={!valid || !wallet || busy}>
            {busy ? "WORKING…" : "DEPLOY ON MONAD TESTNET"}
          </button>
          <div className={styles.status}>{status}</div>

          {result && (
            <div className={styles.result}>
              <span>MONAD TEST TOKEN CREATED</span>
              <strong>{symbol.trim().toUpperCase()}</strong>
              <code>{result.address}</code>
              <a href={result.explorerUrl} target="_blank" rel="noreferrer">Open contract in explorer ↗</a>
            </div>
          )}
        </div>
      </section>

      <section className={styles.notes}>
        <article><b>Chain guard</b><p>Deployment is blocked unless the wallet reports chain ID 10143.</p></article>
        <article><b>Fixed supply</b><p>The full supply is minted once to the connected wallet.</p></article>
        <article><b>Mainnet locked</b><p>This route contains no Monad mainnet deployment action.</p></article>
      </section>
    </main>
  );
}
