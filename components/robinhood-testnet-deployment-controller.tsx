"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  parseEventLogs,
  type Address,
  type Hash,
} from "viem";
import { ERC20_MIN_ABI } from "@/lib/bonding-curve-config";
import {
  ROBINHOOD_TESTNET,
  ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL,
  ROBINHOOD_TESTNET_CHAIN_ID_HEX,
} from "@/lib/chains";
import {
  getCurveLaunchPipelineAddress,
  HOODLUMS_BONDING_CURVE_FUND_ABI,
  HOODLUMS_CURVE_LAUNCH_PIPELINE_ABI,
  resolveCurveLaunchParams,
} from "@/lib/curve-launch-pipeline-config";
import {
  FIXED_SUPPLY_TOKEN_ABI,
  FIXED_SUPPLY_TOKEN_BYTECODE,
} from "@/lib/evm-token-artifact";
import {
  ACCOUNT_WALLET_STORAGE_KEY,
  parseStoredAccountWallet,
} from "@/lib/account-wallet-state";
import { describeWalletMismatch } from "@/lib/social-studio-queue";
import { captureTokenArtworkThumbnail } from "@/lib/token-artwork-thumbnail";
import { notifyTokenLaunchCompleted } from "@/lib/token-launch-events";
import type { TokenProject } from "@/lib/types";
import styles from "./robinhood-testnet-deployment-controller.module.css";

type Eip1193Provider = {
  request: (args: {
    method: string;
    params?: unknown[] | Record<string, unknown>;
  }) => Promise<unknown>;
};

type BrowserWindow = Window & {
  ethereum?: Eip1193Provider;
  __launchpadEthereum?: Eip1193Provider;
  __launchpadEthereumInfo?: { name?: string; rdns?: string };
};

type DeploymentResult = {
  contractAddress: Address;
  transactionHash: Hash;
  curveAddress?: Address;
  curveFunded?: boolean;
  recordWarning?: string;
};

type WalletMismatch = {
  activeAccount: string;
  confirmedAccount: string;
  message: string;
};

const STORAGE_KEY = "private-meme-token-studio-projects-v1";
const TARGET_CHAIN_ID = ROBINHOOD_TESTNET_CHAIN_ID_HEX.toLowerCase();
const EXPLORER_URL = "https://explorer.testnet.chain.robinhood.com";

const robinhoodTestnet = defineChain({
  id: ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL,
  name: ROBINHOOD_TESTNET.chainName,
  nativeCurrency: ROBINHOOD_TESTNET.nativeCurrency,
  rpcUrls: { default: { http: [...ROBINHOOD_TESTNET.rpcUrls] } },
  blockExplorers: {
    default: {
      name: "Robinhood Chain Testnet Explorer",
      url: EXPLORER_URL,
    },
  },
  testnet: true,
});

function getProvider(): Eip1193Provider | null {
  const browserWindow = window as BrowserWindow;
  return browserWindow.__launchpadEthereum || browserWindow.ethereum || null;
}

function normaliseChainId(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "";
  const radix = trimmed.startsWith("0x") ? 16 : 10;
  const numeric = Number.parseInt(trimmed.replace(/^0x/, ""), radix);
  return Number.isFinite(numeric) ? `0x${numeric.toString(16)}` : "";
}

function readPreparedProject(): TokenProject | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as TokenProject[]) : [];
    if (!Array.isArray(parsed)) return null;
    return parsed.find((item) => item.chain === "robinhood") || null;
  } catch {
    return null;
  }
}

function updateStoredProject(project: TokenProject, contractAddress: string) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as TokenProject[]) : [];
    const projects = Array.isArray(parsed) ? parsed : [];
    const updated: TokenProject = {
      ...project,
      contractAddress,
      status: "launched",
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        updated,
        ...projects.filter((item) => item.id !== project.id),
      ]),
    );
  } catch {
    // The on-chain deployment remains valid when local saving is unavailable.
  }
}

function updateStudioContractAddress(contractAddress: string) {
  const input = Array.from(
    document.querySelectorAll<HTMLInputElement>(".builder-panel input"),
  ).find((item) => item.placeholder === "Filled automatically after launch");
  if (!input) return;

  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, contractAddress);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function shortAddress(value: string): string {
  return value.length > 18 ? `${value.slice(0, 9)}…${value.slice(-7)}` : value;
}

function readError(error: unknown): string {
  if (typeof error === "object" && error && "shortMessage" in error) {
    return String((error as { shortMessage: unknown }).shortMessage);
  }
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "The deployment failed.";
}

export function RobinhoodTestnetDeploymentController() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [project, setProject] = useState<TokenProject | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(
    "Ready to deploy with test ETH. Mainnet remains blocked.",
  );
  const [result, setResult] = useState<DeploymentResult | null>(null);
  const [mismatch, setMismatch] = useState<WalletMismatch | null>(null);
  const [bypassMismatch, setBypassMismatch] = useState(false);

  useEffect(() => {
    let activeHost: HTMLElement | null = null;
    let hiddenWarning: HTMLElement | null = null;

    function attach() {
      const modal = document.querySelector<HTMLElement>(".launch-modal");
      if (!modal) {
        if (activeHost) setHost(null);
        activeHost = null;
        return;
      }

      let nextHost = modal.querySelector<HTMLElement>(
        "[data-robinhood-testnet-deployer]",
      );
      if (!nextHost) {
        nextHost = document.createElement("div");
        nextHost.dataset.robinhoodTestnetDeployer = "true";
        const warning = modal.querySelector<HTMLElement>(".warning-box");
        if (warning) {
          warning.before(nextHost);
          warning.style.display = "none";
          hiddenWarning = warning;
        } else {
          modal.append(nextHost);
        }
      }

      if (nextHost !== activeHost) {
        activeHost = nextHost;
        setHost(nextHost);
        setProject(readPreparedProject());
        setConfirmed(false);
        setResult(null);
        setMismatch(null);
        setBypassMismatch(false);
        setStatus("Ready to deploy with test ETH. Mainnet remains blocked.");
      }
    }

    attach();
    const observer = new MutationObserver(attach);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      if (hiddenWarning) hiddenWarning.style.display = "";
      activeHost?.remove();
    };
  }, []);

  const switchToTestnet = useCallback(async (provider: Eip1193Provider) => {
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: ROBINHOOD_TESTNET.chainId }],
      });
    } catch (switchError) {
      if ((switchError as { code?: number })?.code !== 4902) throw switchError;
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [ROBINHOOD_TESTNET],
      });
    }
  }, []);

  /**
   * Compares the wallet app's active account against the account confirmed
   * on Hoodlums via the Account panel (AccountWalletBridge — the same
   * `hoodlums.account.wallet` localStorage key). This is the actual bug
   * report behind issue #409 Part 4: `getProvider()` above prefers
   * `window.__launchpadEthereum` (the exact provider object
   * AccountWalletBridge confirmed), but that in-memory reference only
   * exists for the lifetime of the page that confirmed it — a fresh page
   * load (a hard refresh, or opening the studio in a new tab) silently
   * falls back to the bare injected `window.ethereum`, which can have a
   * different account active than the one actually confirmed, launching
   * the token under the wrong wallet with no warning. Reuses the
   * describeWalletMismatch pattern already used by Social Studio (issue
   * #388) rather than inventing a second mismatch-warning shape. Returns
   * true when the launch should stop and show the warning.
   */
  function checkWalletMismatch(activeAccount: string): boolean {
    if (bypassMismatch) return false;

    const confirmedAccount = parseStoredAccountWallet(
      localStorage.getItem(ACCOUNT_WALLET_STORAGE_KEY),
    )?.account;
    if (!confirmedAccount) return false;

    const message = describeWalletMismatch(activeAccount, confirmedAccount);
    if (!message) return false;

    setMismatch({ activeAccount, confirmedAccount, message });
    return true;
  }

  function continueWithMismatchedWallet() {
    setBypassMismatch(true);
    setMismatch(null);
    setStatus("Continuing — the token will belong to the wallet app's active account.");
  }

  /**
   * Best-effort: tells the server about a just-completed curve-backed launch
   * so the homepage grid (issue #412 Part 1) can show it without a manual
   * refresh. Wallet-signed, then independently reconciled against a live
   * chain read server-side before any row is stored. Mirrors
   * components/testnet-launcher.tsx's own recordTokenLaunch exactly — kept
   * as a second, independently testable copy rather than a shared import so
   * that file's own locked-down source-assertion tests
   * (tests/testnet-launcher-curve-pipeline.test.ts) are never put at risk by
   * a refactor here.
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
    artworkThumbnail: string | null,
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

    // artworkThumbnail rides alongside the signed payload, not inside it —
    // it is cosmetic, non-authoritative data (issue #438) and keeps the
    // wallet signature message small and human-readable.
    const recordResponse = await fetch("/api/token-launches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...payload,
        challengeId: challenge.challengeId,
        nonce: challenge.nonce,
        signature,
        artworkThumbnail,
      }),
    });
    if (!recordResponse.ok) {
      const error = (await recordResponse.json().catch(() => null)) as { error?: string } | null;
      throw new Error(error?.error || "The launch could not be recorded for the homepage.");
    }

    notifyTokenLaunchCompleted({ tokenAddress: launch.tokenAddress, chainId: walletChainId });
  }

  /**
   * Deploys a token AND its bonding curve via HoodlumsCurveLaunchPipeline
   * (Milestone A, issue #409 Part 1's named follow-up, closed by issue
   * #412 Part 1: "the studio's launch modal now routes through PR A's
   * pipeline too"), chaining the three wallet signatures
   * components/testnet-launcher.tsx already established: deploy, approve,
   * fundCurve. Falls back to the plain FixedSupplyMemeToken deploy below
   * when no pipeline is configured for the connected chain.
   */
  async function deployWithCurvePipeline(
    walletClient: ReturnType<typeof createWalletClient>,
    publicClient: ReturnType<typeof createPublicClient>,
    account: Address,
    pipelineAddress: Address,
    currentProject: TokenProject,
  ): Promise<DeploymentResult> {
    const curveParams = resolveCurveLaunchParams(currentProject.decimals);

    setStatus("Step 1 of 3 — deploying token + curve. Check your wallet…");
    const launchHash = await walletClient.writeContract({
      account,
      chain: robinhoodTestnet,
      address: pipelineAddress,
      abi: HOODLUMS_CURVE_LAUNCH_PIPELINE_ABI,
      functionName: "launchTokenWithCurve",
      args: [
        currentProject.name.trim(),
        currentProject.ticker.trim().toUpperCase(),
        BigInt(currentProject.supply),
        currentProject.decimals,
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

    const fullSupplyRaw = BigInt(currentProject.supply) * 10n ** BigInt(currentProject.decimals);

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

    // Downscaled and discarded here — never stored in React state or
    // threaded through props (CLAUDE.md's PR #118 iPhone Safari memory
    // rule; issue #438).
    const artworkThumbnail = await captureTokenArtworkThumbnail(currentProject.heroImage).catch(() => null);

    let recordWarning: string | undefined;
    try {
      await recordTokenLaunch(
        walletClient,
        account,
        {
          tokenAddress,
          curveAddress,
          tokenName: currentProject.name.trim(),
          ticker: currentProject.ticker.trim().toUpperCase(),
          decimals: currentProject.decimals,
          wholeTokenSupply: currentProject.supply,
          graduationTargetWei: curveParams.graduationTargetWei,
        },
        artworkThumbnail,
      );
    } catch (recordError) {
      // Never fail the launch over this — the token and curve are already
      // live on-chain. Surfaced only in the result panel, not a thrown error.
      recordWarning = readError(recordError);
    }

    return {
      contractAddress: tokenAddress,
      transactionHash: launchHash,
      curveAddress,
      curveFunded: true,
      recordWarning,
    };
  }

  async function deploy() {
    if (!project || busy || !confirmed) return;
    const provider = getProvider();
    if (!provider) {
      setStatus("Reconnect MetaMask from the builder before deploying.");
      return;
    }

    setBusy(true);
    setResult(null);
    setMismatch(null);
    try {
      const currentChainId = normaliseChainId(
        await provider.request({ method: "eth_chainId" }),
      );
      if (currentChainId !== TARGET_CHAIN_ID) {
        setStatus("Switching your wallet to Robinhood Chain…");
        await switchToTestnet(provider);
      }

      const verifiedChainId = normaliseChainId(
        await provider.request({ method: "eth_chainId" }),
      );
      if (verifiedChainId !== TARGET_CHAIN_ID) {
        throw new Error(
          `Deployment blocked: wallet chain must be ${ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL}.`,
        );
      }

      const accounts = (await provider.request({
        method: "eth_requestAccounts",
      })) as string[];
      const account = accounts[0] as Address | undefined;
      if (!account) throw new Error("The selected wallet returned no account.");

      if (checkWalletMismatch(account)) {
        setStatus("Wallet mismatch — resolve it below before launching.");
        return;
      }

      const transport = custom(provider);
      const walletClient = createWalletClient({
        chain: robinhoodTestnet,
        transport,
      });
      const publicClient = createPublicClient({
        chain: robinhoodTestnet,
        transport,
      });

      const pipelineAddress = getCurveLaunchPipelineAddress(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL);
      let deploymentResult: DeploymentResult;
      if (pipelineAddress) {
        deploymentResult = await deployWithCurvePipeline(walletClient, publicClient, account, pipelineAddress, project);
      } else {
        setStatus("Review and approve the contract deployment in MetaMask…");
        const transactionHash = await walletClient.deployContract({
          account,
          abi: FIXED_SUPPLY_TOKEN_ABI,
          bytecode: FIXED_SUPPLY_TOKEN_BYTECODE,
          args: [
            project.name.trim(),
            project.ticker.trim().toUpperCase(),
            BigInt(project.supply),
            project.decimals,
            account,
          ],
        });

        setStatus(`Deployment submitted: ${shortAddress(transactionHash)}`);
        const receipt = await publicClient.waitForTransactionReceipt({
          hash: transactionHash,
        });
        if (!receipt.contractAddress) {
          throw new Error("The confirmed receipt did not contain a contract address.");
        }
        deploymentResult = { contractAddress: receipt.contractAddress, transactionHash };
      }

      const { contractAddress } = deploymentResult;
      setResult(deploymentResult);
      updateStoredProject(project, contractAddress);
      updateStudioContractAddress(contractAddress);
      setProject((current) =>
        current
          ? { ...current, contractAddress, status: "launched" }
          : current,
      );
      setBypassMismatch(false);
      setStatus(
        deploymentResult.curveAddress
          ? "Token and bonding curve deployed successfully. Mainnet is still blocked."
          : "Token deployed successfully. Mainnet is still blocked.",
      );
    } catch (error) {
      setStatus(readError(error));
    } finally {
      setBusy(false);
    }
  }

  if (!host || !project) return null;

  const browserWindow = window as BrowserWindow;
  const walletName =
    browserWindow.__launchpadEthereumInfo?.name || "confirmed EVM wallet";

  return createPortal(
    <section className={styles.panel} aria-live="polite">
      <header>
        <div>
          <small>TOKEN DEPLOYMENT</small>
          <h3>Deploy ERC-20 token</h3>
        </div>
        <span>READY</span>
      </header>

      <dl>
        <div><dt>Network</dt><dd>Robinhood Chain</dd></div>
        <div><dt>Chain ID</dt><dd>{ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL} · {TARGET_CHAIN_ID}</dd></div>
        <div><dt>Wallet route</dt><dd>{walletName}</dd></div>
        <div><dt>Token</dt><dd>{project.name} · ${project.ticker}</dd></div>
      </dl>

      <label className={styles.confirmation}>
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          disabled={busy || Boolean(result)}
        />
        <span>
          I understand this creates a real contract using test ETH only. It does
          not add liquidity or enable a mainnet launch.
        </span>
      </label>

      {mismatch && (
        <div className={styles.mismatchWarning}>
          <strong>Wallet mismatch</strong>
          <p>{mismatch.message}</p>
          <div className={styles.mismatchActions}>
            <button type="button" onClick={() => setMismatch(null)} disabled={busy}>
              Switch wallet
            </button>
            <button type="button" onClick={continueWithMismatchedWallet} disabled={busy}>
              Continue anyway — belongs to {shortAddress(mismatch.activeAccount)}
            </button>
          </div>
        </div>
      )}

      <div className={styles.status}>{status}</div>

      {result ? (
        <div className={styles.result}>
          <b>TOKEN DEPLOYED</b>
          <code>{result.contractAddress}</code>
          <div>
            <a
              href={`${EXPLORER_URL}/address/${result.contractAddress}`}
              target="_blank"
              rel="noreferrer"
            >
              View contract ↗
            </a>
            <a
              href={`${EXPLORER_URL}/tx/${result.transactionHash}`}
              target="_blank"
              rel="noreferrer"
            >
              View transaction ↗
            </a>
          </div>
          {result.curveAddress && (
            <>
              <b>{result.curveFunded ? "CURVE FUNDED" : "CURVE"}</b>
              <code>{result.curveAddress}</code>
            </>
          )}
          {result.recordWarning && (
            <p className={styles.recordWarning}>
              Launched on-chain, but the homepage listing could not be recorded yet: {result.recordWarning}
            </p>
          )}
        </div>
      ) : (
        <button
          className={styles.deployButton}
          type="button"
          onClick={deploy}
          disabled={!confirmed || busy}
        >
          {busy ? "DEPLOYING…" : "DEPLOY TOKEN"}
        </button>
      )}

      <footer>
        Private keys are never requested or stored. Every deployment requires
        approval in the exact wallet selected through the launchpad.
      </footer>
    </section>,
    host,
  );
}
