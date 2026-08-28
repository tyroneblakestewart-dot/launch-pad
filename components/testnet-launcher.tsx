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
  parseEventLogs,
  type Address,
} from "viem";
import {
  FIXED_SUPPLY_TOKEN_ABI,
  FIXED_SUPPLY_TOKEN_BYTECODE,
} from "@/lib/evm-token-artifact";
import { getFactoryAddress, HOODLUMS_TOKEN_FACTORY_ABI } from "@/lib/factory-config";
import { extractLaunchedTokenAddress } from "@/lib/factory-launch";
import { ERC20_MIN_ABI } from "@/lib/bonding-curve-config";
import {
  getCurveLaunchPipelineAddress,
  HOODLUMS_BONDING_CURVE_FUND_ABI,
  HOODLUMS_CURVE_LAUNCH_PIPELINE_ABI,
  resolveCurveLaunchParams,
} from "@/lib/curve-launch-pipeline-config";
import {
  LaunchLookupError,
  resolvePipelineLaunchByTokenAddress,
} from "@/lib/curve-launch-pipeline-lookup";
import {
  ACCOUNT_WALLET_STORAGE_KEY,
  parseStoredAccountWallet,
} from "@/lib/account-wallet-state";
import { describeWalletMismatch } from "@/lib/social-studio-queue";
import { notifyTokenLaunchCompleted } from "@/lib/token-launch-events";
import { getInjectedEvmProvider } from "@/lib/wallet-provider";
import styles from "./testnet-launcher.module.css";

type Network = "robinhood-testnet" | "solana-devnet";
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
  curveAddress?: string;
  curveFunded?: boolean;
  recordWarning?: string;
};

type WalletMismatch = {
  activeAccount: string;
  confirmedAccount: string;
  message: string;
};

/**
 * Everything recordTokenLaunch needs to retry, held in state from the
 * moment the on-chain launch succeeds (issue #425) — a retry never redoes
 * any on-chain step, it only requests a fresh challenge and signature over
 * these already-known facts.
 */
type PendingRecord = {
  tokenAddress: Address;
  curveAddress: Address;
  tokenName: string;
  ticker: string;
  decimals: number;
  wholeTokenSupply: string;
  graduationTargetWei: bigint;
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
  const [mismatch, setMismatch] = useState<WalletMismatch | null>(null);
  const [bypassMismatch, setBypassMismatch] = useState(false);
  const [pendingRecord, setPendingRecord] = useState<PendingRecord | null>(null);
  const [recordRetryBusy, setRecordRetryBusy] = useState(false);
  const [existingLaunchAddress, setExistingLaunchAddress] = useState("");
  const [existingLaunchBusy, setExistingLaunchBusy] = useState(false);
  const [existingLaunchStatus, setExistingLaunchStatus] = useState<string | null>(null);

  const pipelineAddress = getCurveLaunchPipelineAddress(robinhoodTestnet.id);
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
    setMismatch(null);
    setBypassMismatch(false);
    setDecimals(next === "solana-devnet" ? 9 : 18);
    setStatus("Network changed. Reconnect the matching wallet before deploying.");
  }

  /**
   * Compares the wallet app's active EVM account against the account
   * confirmed on Hoodlums (the Account panel's `hoodlums.account.wallet`
   * localStorage entry — the only wallet identity a browser-local project
   * draft has, since drafts themselves carry no owner field). Reuses the
   * describeWalletMismatch pattern from issue #388 so this guard reads and
   * warns identically to the Social Studio queue's own wallet-mismatch
   * checks. Returns true when the launch should stop and show the warning.
   */
  function checkWalletMismatch(activeAccount: string): boolean {
    if (bypassMismatch) return false;

    const confirmedAccount = parseStoredAccountWallet(
      typeof window === "undefined" ? null : window.localStorage.getItem(ACCOUNT_WALLET_STORAGE_KEY),
    )?.account;
    if (!confirmedAccount) return false;

    const message = describeWalletMismatch(activeAccount, confirmedAccount);
    if (!message) return false;

    setMismatch({ activeAccount, confirmedAccount, message });
    return true;
  }

  async function connectWallet() {
    setBusy(true);
    setResult(null);
    setMismatch(null);
    setBypassMismatch(false);
    try {
      if (network === "robinhood-testnet") {
        const provider = getInjectedEvmProvider();
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
        setStatus("Robinhood Chain wallet connected.");
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

  /**
   * Best-effort: tells the server about a just-completed curve-backed launch
   * (Milestone A, issue #409 Part 2) so it can become homepage-grid data
   * once a follow-up PR wires that grid to read from it. Wallet-signed, then
   * independently reconciled against a live chain read server-side before
   * any row is stored — this call never blocks or fails the on-chain launch
   * itself, which has already succeeded by the time this runs.
   */
  async function recordTokenLaunch(
    walletClient: ReturnType<typeof createWalletClient>,
    account: Address,
    launch: {
      tokenAddress: Address;
      curveAddress: Address;
      tokenName: string;
      ticker: string;
      decimals: number;
      wholeTokenSupply: string;
      graduationTargetWei: bigint;
    },
  ): Promise<void> {
    const walletChainId = await walletClient.getChainId();
    const payload = {
      chainId: String(robinhoodTestnet.id),
      tokenAddress: launch.tokenAddress,
      curveAddress: launch.curveAddress,
      tokenName: launch.tokenName,
      ticker: launch.ticker,
      decimals: String(launch.decimals),
      wholeTokenSupply: launch.wholeTokenSupply,
      graduationTargetWei: launch.graduationTargetWei.toString(),
    };

    const challengeResponse = await fetch("/api/token-launches/challenge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        walletAddress: account,
        walletChainId,
        purpose: "token-launch:record",
        payload,
      }),
    });
    if (!challengeResponse.ok) throw new Error("Could not start the launch recording request.");
    const challenge = (await challengeResponse.json()) as { challengeId: string; nonce: string; message: string };

    const signature = await walletClient.signMessage({ account, message: challenge.message });

    const recordResponse = await fetch("/api/token-launches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...payload,
        challengeId: challenge.challengeId,
        nonce: challenge.nonce,
        signature,
      }),
    });
    if (!recordResponse.ok) {
      const error = (await recordResponse.json().catch(() => null)) as { error?: string } | null;
      throw new Error(error?.error || "The launch could not be recorded for the homepage.");
    }

    // Lets the homepage grid refetch immediately instead of waiting for its
    // next poll tick (issue #412 Part 1).
    notifyTokenLaunchCompleted({ tokenAddress: launch.tokenAddress, chainId: walletChainId });
  }

  /**
   * Deploys a token AND its bonding curve via HoodlumsCurveLaunchPipeline
   * (Milestone A, issue #409 Part 1), then chains the two remaining
   * signatures the curve contract itself requires — approve() and
   * fundCurve() — so the whole flow reaches a tradeable curve without the
   * creator having to leave this page or copy any address by hand. Three
   * wallet signatures total: this is the fewest the existing, unmodified
   * FixedSupplyMemeToken/HoodlumsTestBondingCurve contracts allow, since
   * fundCurve() requires an ERC-20 approve() the creator must sign
   * themselves (see contracts/HoodlumsCurveLaunchPipeline.sol's top comment
   * for why this contract doesn't also hold/move the token to shortcut it
   * further).
   */
  async function deployRobinhoodTokenWithCurve(
    walletClient: ReturnType<typeof createWalletClient>,
    publicClient: ReturnType<typeof createPublicClient>,
    account: Address,
    pipelineContractAddress: Address,
  ): Promise<LaunchResult> {
    const curveParams = resolveCurveLaunchParams(decimals);

    setStatus("Step 1 of 3 — deploying token + curve. Check your wallet…");
    const launchHash = await walletClient.writeContract({
      account,
      chain: robinhoodTestnet,
      address: pipelineContractAddress,
      abi: HOODLUMS_CURVE_LAUNCH_PIPELINE_ABI,
      functionName: "launchTokenWithCurve",
      args: [
        name.trim(),
        symbol.trim().toUpperCase(),
        BigInt(supply),
        decimals,
        curveParams.virtualTokenReserveRaw,
        curveParams.virtualEthReserveWei,
        curveParams.graduationTargetWei,
      ],
    });
    setStatus(`Step 1 of 3 submitted: ${shortAddress(launchHash)}`);
    const launchReceipt = await publicClient.waitForTransactionReceipt({ hash: launchHash });
    const launchEvents = parseEventLogs({
      abi: HOODLUMS_CURVE_LAUNCH_PIPELINE_ABI,
      eventName: "TokenAndCurveLaunched",
      logs: launchReceipt.logs,
    });
    const tokenAddress = launchEvents[0]?.args.token;
    const curveAddress = launchEvents[0]?.args.curve;
    if (!tokenAddress || !curveAddress) {
      throw new Error("Launch receipt did not report a token and curve address.");
    }

    const fullSupplyRaw = BigInt(supply) * 10n ** BigInt(decimals);

    setStatus("Step 2 of 3 — approving the curve for the full supply. Check your wallet…");
    const approveHash = await walletClient.writeContract({
      account,
      chain: robinhoodTestnet,
      address: tokenAddress,
      abi: ERC20_MIN_ABI,
      functionName: "approve",
      args: [curveAddress, fullSupplyRaw],
    });
    setStatus(`Step 2 of 3 submitted: ${shortAddress(approveHash)}`);
    await publicClient.waitForTransactionReceipt({ hash: approveHash });

    setStatus("Step 3 of 3 — funding the curve. Check your wallet…");
    const fundHash = await walletClient.writeContract({
      account,
      chain: robinhoodTestnet,
      address: curveAddress,
      abi: HOODLUMS_BONDING_CURVE_FUND_ABI,
      functionName: "fundCurve",
    });
    setStatus(`Step 3 of 3 submitted: ${shortAddress(fundHash)}`);
    await publicClient.waitForTransactionReceipt({ hash: fundHash });

    const pending: PendingRecord = {
      tokenAddress,
      curveAddress,
      tokenName: name.trim(),
      ticker: symbol.trim().toUpperCase(),
      decimals,
      wholeTokenSupply: supply,
      graduationTargetWei: curveParams.graduationTargetWei,
    };
    setPendingRecord(pending);

    let recordWarning: string | undefined;
    try {
      await recordTokenLaunch(walletClient, account, pending);
      setPendingRecord(null);
    } catch (recordError) {
      // Never fail the launch over this — the token and curve are already
      // live on-chain. Surfaced only in the result panel, not a thrown error.
      // pendingRecord stays set so the "Record listing" retry button can
      // resubmit without redoing any on-chain step.
      recordWarning = readError(recordError);
    }

    return {
      address: tokenAddress,
      transaction: launchHash,
      explorerUrl: `https://explorer.testnet.chain.robinhood.com/address/${tokenAddress}`,
      curveAddress,
      curveFunded: true,
      recordWarning,
    };
  }

  async function deployRobinhoodToken(): Promise<LaunchResult> {
    const provider = getInjectedEvmProvider();
    if (!provider) throw new Error("EVM wallet disconnected.");

    const transport = custom(provider);
    const walletClient = createWalletClient({ chain: robinhoodTestnet, transport });
    const publicClient = createPublicClient({ chain: robinhoodTestnet, transport });
    const [account] = await walletClient.getAddresses();
    if (!account) throw new Error("No connected EVM account.");

    if (pipelineAddress) {
      return deployRobinhoodTokenWithCurve(walletClient, publicClient, account, pipelineAddress);
    }

    const factoryAddress = getFactoryAddress(robinhoodTestnet.id);
    const constructorArgs = [
      name.trim(),
      symbol.trim().toUpperCase(),
      BigInt(supply),
      decimals,
      account as Address,
    ] as const;

    const transaction = factoryAddress
      ? await (async () => {
          const launchFee = await publicClient.readContract({
            address: factoryAddress,
            abi: HOODLUMS_TOKEN_FACTORY_ABI,
            functionName: "launchFee",
          });
          return walletClient.writeContract({
            account,
            address: factoryAddress,
            abi: HOODLUMS_TOKEN_FACTORY_ABI,
            functionName: "launchToken",
            args: constructorArgs,
            value: launchFee,
          });
        })()
      : await walletClient.deployContract({
          account,
          abi: FIXED_SUPPLY_TOKEN_ABI,
          bytecode: FIXED_SUPPLY_TOKEN_BYTECODE,
          args: constructorArgs,
        });

    setStatus(`Deployment submitted: ${shortAddress(transaction)}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: transaction });
    const tokenAddress = factoryAddress
      ? extractLaunchedTokenAddress(receipt.logs)
      : receipt.contractAddress;
    if (!tokenAddress) {
      throw new Error("Receipt did not contain a contract address.");
    }

    return {
      address: tokenAddress,
      transaction,
      explorerUrl: `https://explorer.testnet.chain.robinhood.com/address/${tokenAddress}`,
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
      setStatus("Complete the form, connect a wallet and confirm the warning.");
      return;
    }

    if (network === "robinhood-testnet" && checkWalletMismatch(wallet)) {
      setStatus("Wallet mismatch — resolve it below before launching.");
      return;
    }

    setBusy(true);
    setResult(null);
    setMismatch(null);
    setPendingRecord(null);
    setStatus("Waiting for your wallet signature…");
    try {
      const launchResult =
        network === "robinhood-testnet"
          ? await deployRobinhoodToken()
          : await deploySolanaToken();
      setResult(launchResult);
      setBypassMismatch(false);
      setStatus("Test token created successfully.");
    } catch (error) {
      setStatus(readError(error));
    } finally {
      setBusy(false);
    }
  }

  function continueWithMismatchedWallet() {
    setBypassMismatch(true);
    setStatus("Continuing — the token will belong to the wallet app's active account.");
  }

  /**
   * Re-runs recordTokenLaunch for the just-launched token/curve with a
   * brand-new challenge — never reuses the one whose 5-minute window already
   * expired (issue #425). Retryable any number of times; nothing on-chain is
   * redone since `pendingRecord` already holds every fact the payload needs.
   */
  async function retryRecordListing() {
    if (!pendingRecord) return;
    setRecordRetryBusy(true);
    try {
      const provider = getInjectedEvmProvider();
      if (!provider) throw new Error("EVM wallet disconnected.");
      const transport = custom(provider);
      const walletClient = createWalletClient({ chain: robinhoodTestnet, transport });
      const [account] = await walletClient.getAddresses();
      if (!account) throw new Error("No connected EVM account.");

      await recordTokenLaunch(walletClient, account, pendingRecord);
      setPendingRecord(null);
      setResult((previous) => (previous ? { ...previous, recordWarning: undefined } : previous));
    } catch (error) {
      setResult((previous) => (previous ? { ...previous, recordWarning: readError(error) } : previous));
    } finally {
      setRecordRetryBusy(false);
    }
  }

  /**
   * The minimal honest recovery path for a launch whose record attempt was
   * never retried before the panel closed (issue #425): given just the token
   * address, look up its curve and launch facts from the pipeline's own
   * event log and the token contract, then record it through the same
   * wallet-signed, server-verified flow. The server independently confirms
   * everything on-chain before inserting a row — this never bypasses that.
   */
  async function recordExistingLaunch() {
    if (!pipelineAddress || !existingLaunchAddress.trim()) return;
    setExistingLaunchBusy(true);
    setExistingLaunchStatus(null);
    try {
      const provider = getInjectedEvmProvider();
      if (!provider) throw new Error("Connect a Robinhood Chain wallet first.");
      const transport = custom(provider);
      const walletClient = createWalletClient({ chain: robinhoodTestnet, transport });
      const publicClient = createPublicClient({ chain: robinhoodTestnet, transport });
      const [account] = await walletClient.getAddresses();
      if (!account) throw new Error("Connect a Robinhood Chain wallet first.");

      const resolved = await resolvePipelineLaunchByTokenAddress(
        publicClient,
        pipelineAddress,
        existingLaunchAddress,
      );
      await recordTokenLaunch(walletClient, account, resolved);
      setExistingLaunchAddress("");
      setExistingLaunchStatus("Listing recorded — it will appear on the homepage grid shortly.");
    } catch (error) {
      setExistingLaunchStatus(
        error instanceof LaunchLookupError ? error.message : readError(error),
      );
    } finally {
      setExistingLaunchBusy(false);
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
              <i className={styles.robinhoodDot} /> Robinhood Chain
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

          {mismatch && (
            <div className={styles.mismatchWarning}>
              <strong>Wallet mismatch</strong>
              <p>{mismatch.message}</p>
              <div className={styles.mismatchActions}>
                <button onClick={connectWallet} disabled={busy}>
                  Switch wallet
                </button>
                <button onClick={continueWithMismatchedWallet} disabled={busy}>
                  Continue anyway — the token will belong to {shortAddress(mismatch.activeAccount)}
                </button>
              </div>
            </div>
          )}

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
                Open in explorer ↗
              </a>
              {result.curveAddress && (
                <>
                  <span>{result.curveFunded ? "CURVE FUNDED" : "CURVE"}</span>
                  <code>{result.curveAddress}</code>
                </>
              )}
              {result.recordWarning && (
                <div className={styles.recordWarningBox}>
                  <p>
                    Launched on-chain, but the homepage listing could not be recorded: {result.recordWarning}
                  </p>
                  <p>Sign the listing request within 5 minutes. You can retry now.</p>
                  <button onClick={retryRecordListing} disabled={recordRetryBusy}>
                    {recordRetryBusy ? "Check your wallet…" : "Record listing"}
                  </button>
                </div>
              )}
            </div>
          )}

          {network === "robinhood-testnet" && pipelineAddress && (
            <div className={styles.existingLaunch}>
              <span>Already launched a token that isn&apos;t listed?</span>
              <div className={styles.existingLaunchRow}>
                <input
                  placeholder="0xTokenAddress"
                  value={existingLaunchAddress}
                  onChange={(event) => setExistingLaunchAddress(event.target.value)}
                  disabled={existingLaunchBusy}
                />
                <button
                  onClick={recordExistingLaunch}
                  disabled={existingLaunchBusy || !existingLaunchAddress.trim()}
                >
                  {existingLaunchBusy ? "Looking up…" : "Record an existing launch"}
                </button>
              </div>
              {existingLaunchStatus && <p className={styles.existingLaunchStatus}>{existingLaunchStatus}</p>}
            </div>
          )}
        </div>
      </section>

      <section className={styles.notes}>
        <article>
          <b>Robinhood Chain</b>
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
