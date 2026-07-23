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
import {
  ROBINHOOD_TESTNET,
  ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL,
  ROBINHOOD_TESTNET_CHAIN_ID_HEX,
} from "@/lib/chains";
import {
  FIXED_SUPPLY_TOKEN_ABI,
  FIXED_SUPPLY_TOKEN_BYTECODE,
} from "@/lib/evm-token-artifact";
import { HOODLUMS_TOKEN_FACTORY_ABI, getFactoryAddress } from "@/lib/factory-config";
import type { TokenProject } from "@/lib/types";
import { getInjectedEvmProvider } from "@/lib/wallet-provider";
import type { Eip1193Provider } from "@/lib/wallet-provider";
import styles from "./robinhood-testnet-deployment-controller.module.css";

type BrowserWindow = Window & {
  __launchpadEthereumInfo?: { name?: string; rdns?: string };
};

export type DeploymentResult = {
  contractAddress: Address;
  transactionHash: Hash;
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
  return "The testnet deployment failed.";
}

export type DeployClients = {
  account: Address;
  walletClient: ReturnType<typeof createWalletClient>;
  publicClient: ReturnType<typeof createPublicClient>;
};

/**
 * Launches through the deployed HoodlumsTokenFactory: reads `launchFee()`
 * immediately before submitting so the transaction value always matches the
 * fee actually charged, then resolves the new token from `TokenLaunched`.
 */
export async function deployViaFactory(
  factoryAddress: Address,
  project: TokenProject,
  { account, walletClient, publicClient }: DeployClients,
  onStatus: (status: string) => void,
): Promise<DeploymentResult> {
  const launchFee = await publicClient.readContract({
    address: factoryAddress,
    abi: HOODLUMS_TOKEN_FACTORY_ABI,
    functionName: "launchFee",
  });

  onStatus("Review and approve the factory launch transaction in MetaMask…");
  const transactionHash = await walletClient.writeContract({
    account,
    chain: robinhoodTestnet,
    address: factoryAddress,
    abi: HOODLUMS_TOKEN_FACTORY_ABI,
    functionName: "launchToken",
    args: [
      project.name.trim(),
      project.ticker.trim().toUpperCase(),
      BigInt(project.supply),
      project.decimals,
      account,
    ],
    value: launchFee,
  });

  onStatus(`Launch submitted: ${shortAddress(transactionHash)}`);
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: transactionHash,
  });

  const [launchedEvent] = parseEventLogs({
    abi: HOODLUMS_TOKEN_FACTORY_ABI,
    eventName: "TokenLaunched",
    logs: receipt.logs,
  });
  const contractAddress = launchedEvent?.args.token;
  if (!contractAddress) {
    throw new Error("The confirmed receipt did not include a TokenLaunched event.");
  }

  return { contractAddress, transactionHash };
}

/** Deploys `FixedSupplyMemeToken` directly — the path used when no factory is configured. */
export async function deployDirect(
  project: TokenProject,
  { account, walletClient, publicClient }: DeployClients,
  onStatus: (status: string) => void,
): Promise<DeploymentResult> {
  onStatus("Review and approve the testnet contract deployment in MetaMask…");
  const transactionHash = await walletClient.deployContract({
    account,
    chain: robinhoodTestnet,
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

  onStatus(`Deployment submitted: ${shortAddress(transactionHash)}`);
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: transactionHash,
  });
  if (!receipt.contractAddress) {
    throw new Error("The confirmed receipt did not contain a contract address.");
  }

  return { contractAddress: receipt.contractAddress, transactionHash };
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

  async function deploy() {
    if (!project || busy || !confirmed) return;
    const provider = getInjectedEvmProvider();
    if (!provider) {
      setStatus("Reconnect MetaMask from the builder before deploying.");
      return;
    }

    setBusy(true);
    setResult(null);
    try {
      const currentChainId = normaliseChainId(
        await provider.request({ method: "eth_chainId" }),
      );
      if (currentChainId !== TARGET_CHAIN_ID) {
        setStatus("Switching the confirmed wallet to Robinhood Chain Testnet…");
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

      const transport = custom(provider);
      const walletClient = createWalletClient({
        chain: robinhoodTestnet,
        transport,
      });
      const publicClient = createPublicClient({
        chain: robinhoodTestnet,
        transport,
      });

      const clients: DeployClients = { account, walletClient, publicClient };
      const factoryAddress = getFactoryAddress(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL);
      const deploymentResult = factoryAddress
        ? await deployViaFactory(factoryAddress, project, clients, setStatus)
        : await deployDirect(project, clients, setStatus);

      setResult(deploymentResult);
      updateStoredProject(project, deploymentResult.contractAddress);
      updateStudioContractAddress(deploymentResult.contractAddress);
      setProject((current) =>
        current
          ? { ...current, contractAddress: deploymentResult.contractAddress, status: "launched" }
          : current,
      );
      setStatus("Testnet token deployed successfully. Mainnet is still blocked.");
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
          <small>TESTNET DEPLOYMENT</small>
          <h3>Deploy ERC-20 token</h3>
        </div>
        <span>READY</span>
      </header>

      <dl>
        <div><dt>Network</dt><dd>Robinhood Chain Testnet</dd></div>
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
        </div>
      ) : (
        <button
          className={styles.deployButton}
          type="button"
          onClick={deploy}
          disabled={!confirmed || busy}
        >
          {busy ? "DEPLOYING…" : "DEPLOY TESTNET TOKEN"}
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
