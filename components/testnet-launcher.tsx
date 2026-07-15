"use client";

import { useState } from "react";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  clusterApiUrl,
} from "@solana/web3.js";
import {
  AuthorityType,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createInitializeMintInstruction,
  createMintToInstruction,
  createSetAuthorityInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  type Address,
} from "viem";
import {
  FIXED_SUPPLY_TOKEN_ABI,
  FIXED_SUPPLY_TOKEN_BYTECODE,
} from "@/lib/evm-token-artifact";
import styles from "./testnet-launcher.module.css";

type Network = "robinhood-testnet" | "solana-devnet";
type EthereumProvider = {
  request: (args: {
    method: string;
    params?: unknown[] | Record<string, unknown>;
  }) => Promise<unknown>;
};
type PhantomProvider = {
  connect: () => Promise<{ publicKey: { toString: () => string } }>;
  signAndSendTransaction: (
    transaction: Transaction,
  ) => Promise<{ signature: string }>;
};
type LaunchResult = {
  address: string;
  transaction: string;
  explorerUrl: string;
};

const robinhoodTestnet = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.testnet.chain.robinhood.com"] },
  },
  blockExplorers: {
    default: {
      name: "Robinhood Chain Testnet Explorer",
      url: "https://explorer.testnet.chain.robinhood.com",
    },
  },
  testnet: true,
});

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

function getEthereumProvider(): EthereumProvider | undefined {
  return (window as unknown as { ethereum?: EthereumProvider }).ethereum;
}

function getPhantomProvider(): PhantomProvider | undefined {
  const browserWindow = window as unknown as {
    solana?: PhantomProvider;
    phantom?: { solana?: PhantomProvider };
  };
  return browserWindow.phantom?.solana || browserWindow.solana;
}

export function TestnetLauncher() {
  const [network, setNetwork] = useState<Network>("robinhood-testnet");
  const [name, setName] = useState("Hoodlums Test");
  const [symbol, setSymbol] = useState("HOODT");
  const [supply, setSupply] = useState("1000000000");
  const [decimals, setDecimals] = useState(9);
  const [wallet, setWallet] = useState("");
  const [status, setStatus] = useState(
    "Use test funds only. Mainnet deployment is not available on this page.",
  );
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<LaunchResult | null>(null);

  const maxDecimals = network === "solana-devnet" ? 9 : 18;
  const valid =
    name.trim().length >= 2 &&
    name.trim().length <= 32 &&
    /^[A-Za-z0-9]{2,12}$/.test(symbol.trim()) &&
    /^\d+$/.test(supply) &&
    BigInt(supply || "0") > 0n &&
    decimals >= 0 &&
    decimals <= maxDecimals &&
    confirmed;

  function selectNetwork(next: Network) {
    setNetwork(next);
    setWallet("");
    setResult(null);
    setConfirmed(false);
    setDecimals(next === "solana-devnet" ? 9 : 18);
    setStatus("Network changed. Reconnect the matching wallet before deploying.");
  }

  async function connectWallet() {
    setBusy(true);
    setResult(null);
    try {
      if (network === "robinhood-testnet") {
        const provider = getEthereumProvider();
        if (!provider) throw new Error("Install MetaMask or Robinhood Wallet first.");

        try {
          await provider.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: "0xb626" }],
          });
        } catch (switchError) {
          if ((switchError as { code?: number })?.code !== 4902) throw switchError;
          await provider.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: "0xb626",
                chainName: "Robinhood Chain Testnet",
                nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
                rpcUrls: ["https://rpc.testnet.chain.robinhood.com"],
                blockExplorerUrls: ["https://explorer.testnet.chain.robinhood.com"],
              },
            ],
          });
        }

        const accounts = (await provider.request({
          method: "eth_requestAccounts",
        })) as string[];
        if (!accounts[0]) throw new Error("No EVM account was returned.");
        setWallet(accounts[0]);
        setStatus("Robinhood Chain testnet wallet connected.");
      } else {
        const provider = getPhantomProvider();
        if (!provider) throw new Error("Install Phantom first.");
        const response = await provider.connect();
        setWallet(response.publicKey.toString());
        setStatus("Phantom connected for Solana devnet.");
      }
    } catch (error) {
      setStatus(readError(error));
    } finally {
      setBusy(false);
    }
  }

  async function deployRobinhoodToken(): Promise<LaunchResult> {
    const provider = getEthereumProvider();
    if (!provider) throw new Error("EVM wallet disconnected.");

    const transport = custom(provider);
    const walletClient = createWalletClient({ chain: robinhoodTestnet, transport });
    const publicClient = createPublicClient({ chain: robinhoodTestnet, transport });
    const [account] = await walletClient.getAddresses();
    if (!account) throw new Error("No connected EVM account.");

    const transaction = await walletClient.deployContract({
      account,
      abi: FIXED_SUPPLY_TOKEN_ABI,
      bytecode: FIXED_SUPPLY_TOKEN_BYTECODE,
      args: [
        name.trim(),
        symbol.trim().toUpperCase(),
        BigInt(supply),
        decimals,
        account as Address,
      ],
    });

    setStatus(`Deployment submitted: ${shortAddress(transaction)}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: transaction });
    if (!receipt.contractAddress) {
      throw new Error("Receipt did not contain a contract address.");
    }

    return {
      address: receipt.contractAddress,
      transaction,
      explorerUrl: `https://explorer.testnet.chain.robinhood.com/address/${receipt.contractAddress}`,
    };
  }

  async function deploySolanaToken(): Promise<LaunchResult> {
    const provider = getPhantomProvider();
    if (!provider) throw new Error("Phantom disconnected.");

    const payer = new PublicKey(wallet);
    const amount = BigInt(supply) * 10n ** BigInt(decimals);
    if (amount > 2n ** 64n - 1n) {
      throw new Error("Supply multiplied by decimals exceeds Solana's u64 token limit.");
    }

    const connection = new Connection(
      process.env.NEXT_PUBLIC_SOLANA_DEVNET_RPC || clusterApiUrl("devnet"),
      "confirmed",
    );
    const mint = Keypair.generate();
    const rent = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);
    const tokenAccount = await getAssociatedTokenAddress(mint.publicKey, payer);
    const latestBlockhash = await connection.getLatestBlockhash("confirmed");

    const transaction = new Transaction({
      feePayer: payer,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    }).add(
      SystemProgram.createAccount({
        fromPubkey: payer,
        newAccountPubkey: mint.publicKey,
        lamports: rent,
        space: MINT_SIZE,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMintInstruction(
        mint.publicKey,
        decimals,
        payer,
        null,
        TOKEN_PROGRAM_ID,
      ),
      createAssociatedTokenAccountInstruction(
        payer,
        tokenAccount,
        payer,
        mint.publicKey,
        TOKEN_PROGRAM_ID,
      ),
      createMintToInstruction(
        mint.publicKey,
        tokenAccount,
        payer,
        amount,
        [],
        TOKEN_PROGRAM_ID,
      ),
      createSetAuthorityInstruction(
        mint.publicKey,
        payer,
        AuthorityType.MintTokens,
        null,
        [],
        TOKEN_PROGRAM_ID,
      ),
    );

    transaction.partialSign(mint);
    const response = await provider.signAndSendTransaction(transaction);
    setStatus(`Mint transaction submitted: ${shortAddress(response.signature)}`);
    await connection.confirmTransaction(
      {
        signature: response.signature,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      },
      "confirmed",
    );

    return {
      address: mint.publicKey.toBase58(),
      transaction: response.signature,
      explorerUrl: `https://explorer.solana.com/address/${mint.publicKey.toBase58()}?cluster=devnet`,
    };
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
      const launchResult =
        network === "robinhood-testnet"
          ? await deployRobinhoodToken()
          : await deploySolanaToken();
      setResult(launchResult);
      setStatus("Test token created successfully.");
    } catch (error) {
      setStatus(readError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <a href="/">← Back to studio</a>
        <span>TEST FUNDS ONLY</span>
      </header>

      <section className={styles.content}>
        <div className={styles.intro}>
          <p>WALLET-SIGNED TEST LAB</p>
          <h1>Prove the launch<br />before mainnet.</h1>
          <p className={styles.lead}>
            This page creates a real test token without receiving or storing your private key.
            It does not create liquidity, metadata or a public sale.
          </p>
        </div>

        <div className={styles.card}>
          <div className={styles.networkPicker}>
            <button
              className={network === "robinhood-testnet" ? styles.active : ""}
              onClick={() => selectNetwork("robinhood-testnet")}
            >
              <i className={styles.robinhoodDot} /> Robinhood testnet
            </button>
            <button
              className={network === "solana-devnet" ? styles.active : ""}
              onClick={() => selectNetwork("solana-devnet")}
            >
              <i className={styles.solanaDot} /> Solana devnet
            </button>
          </div>

          <div className={styles.grid}>
            <label>
              <span>Token name</span>
              <input value={name} onChange={(event) => setName(event.target.value)} maxLength={32} />
            </label>
            <label>
              <span>Ticker</span>
              <input
                value={symbol}
                onChange={(event) =>
                  setSymbol(event.target.value.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12))
                }
              />
            </label>
            <label>
              <span>Whole-token supply</span>
              <input
                value={supply}
                inputMode="numeric"
                onChange={(event) => setSupply(event.target.value.replace(/\D/g, ""))}
              />
            </label>
            <label>
              <span>Decimals</span>
              <input
                type="number"
                min={0}
                max={maxDecimals}
                value={decimals}
                onChange={(event) => setDecimals(Number(event.target.value))}
              />
            </label>
          </div>

          <button className={styles.walletButton} onClick={connectWallet} disabled={busy}>
            {wallet ? `Wallet: ${shortAddress(wallet)}` : "Connect wallet"}
          </button>

          <label className={styles.confirmation}>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span>
              I understand this must use worthless test ETH or devnet SOL and creates no market or liquidity.
            </span>
          </label>

          <div className={styles.status}>{status}</div>

          <button
            className={styles.deployButton}
            onClick={deploy}
            disabled={!valid || !wallet || busy}
          >
            {busy
              ? "Check your wallet…"
              : network === "robinhood-testnet"
                ? "Deploy fixed-supply test ERC-20"
                : "Create fixed-supply devnet SPL mint"}
          </button>

          {result && (
            <div className={styles.result}>
              <span>CREATED</span>
              <strong>{shortAddress(result.address)}</strong>
              <code>{result.address}</code>
              <a href={result.explorerUrl} target="_blank" rel="noreferrer">
                Open in testnet explorer ↗
              </a>
            </div>
          )}
        </div>
      </section>

      <section className={styles.notes}>
        <article>
          <b>Robinhood testnet</b>
          <p>Deploys a burnable ERC-20 with a fixed constructor supply, no owner and no external mint function.</p>
        </article>
        <article>
          <b>Solana devnet</b>
          <p>Creates the mint and your associated account, mints the supply and permanently revokes mint authority.</p>
        </article>
        <article>
          <b>Still excluded</b>
          <p>Metadata storage, liquidity, bonding curves, mainnet mode and automated social accounts.</p>
        </article>
      </section>
    </main>
  );
}
