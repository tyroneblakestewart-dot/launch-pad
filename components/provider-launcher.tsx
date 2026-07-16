"use client";

import Link from "next/link";
import { ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  createPublicClient,
  http,
  isAddress,
  parseAbi,
  type Address,
  type Hash,
} from "viem";
import { ROBINHOOD_MAINNET } from "@/lib/chains";
import type { TokenProject } from "@/lib/types";
import styles from "./provider-launcher.module.css";

const PROJECT_STORAGE_KEY = "private-meme-token-studio-projects-v1";
const LAUNCH_STORAGE_KEY = "private-meme-token-studio-provider-launches-v1";
const NOXA_FACTORY = "0xD9eC2db5f3D1b236843925949fe5bd8a3836FCcB";

const ERC20_ABI = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
]);

type ProviderId = "noxa" | "pons";

type EthereumProvider = {
  request: (args: {
    method: string;
    params?: unknown[] | Record<string, unknown>;
  }) => Promise<unknown>;
};

type LaunchVerification = {
  provider: ProviderId;
  projectId: string;
  contractAddress: string;
  transactionHash: string;
  tokenName: string;
  symbol: string;
  decimals: number;
  totalSupply: string;
  factoryConfirmed: boolean | null;
  verifiedAt: string;
};

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

const PROVIDERS = {
  noxa: {
    id: "noxa" as const,
    name: "NOXA Fun",
    launchUrl: "https://fun.noxa.fi/rh/launch",
    label: "Launch + immediate buy handoff",
    description:
      "Prepare the launch pack here, complete the wallet-signed launch on NOXA, verify the token, then continue straight to the official provider for the creator buy.",
    factory: NOXA_FACTORY,
  },
  pons: {
    id: "pons" as const,
    name: "Pons Family",
    launchUrl: "https://pons.family/launchpad/create",
    label: "Launch + immediate buy handoff",
    description:
      "Prepare the launch pack here, complete the launch through Pons, verify the resulting ERC-20, then continue straight to the official provider for the creator buy.",
    factory: null,
  },
};

function readError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "shortMessage" in error) {
    return String((error as { shortMessage: unknown }).shortMessage);
  }
  return "The provider action could not be completed.";
}

function shortAddress(value: string): string {
  return value.length > 13 ? `${value.slice(0, 7)}…${value.slice(-5)}` : value;
}

function formatTokenAmount(value: bigint, decimals: number): string {
  const divisor = 10n ** BigInt(decimals);
  const whole = value / divisor;
  const remainder = value % divisor;
  if (remainder === 0n) return whole.toLocaleString("en-GB");
  const fractional = remainder.toString().padStart(decimals, "0").slice(0, 6);
  return `${whole.toLocaleString("en-GB")}.${fractional.replace(/0+$/, "")}`;
}

function isPositiveAmount(value: string): boolean {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

export function ProviderLauncher() {
  const [projects, setProjects] = useState<TokenProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [providerId, setProviderId] = useState<ProviderId>("noxa");
  const [name, setName] = useState("");
  const [ticker, setTicker] = useState("");
  const [description, setDescription] = useState("");
  const [website, setWebsite] = useState("");
  const [xHandle, setXHandle] = useState("");
  const [telegram, setTelegram] = useState("");
  const [creatorWallet, setCreatorWallet] = useState("");
  const [developerBuy, setDeveloperBuy] = useState("0");
  const [immediateBuyEnabled, setImmediateBuyEnabled] = useState(true);
  const [artwork, setArtwork] = useState("");
  const [contractAddress, setContractAddress] = useState("");
  const [transactionHash, setTransactionHash] = useState("");
  const [walletAddress, setWalletAddress] = useState("");
  const [status, setStatus] = useState(
    "Choose a saved Robinhood Chain project or enter the launch details manually.",
  );
  const [busy, setBusy] = useState(false);
  const [balanceBusy, setBalanceBusy] = useState(false);
  const [verification, setVerification] = useState<LaunchVerification | null>(null);
  const [tokenBalanceRaw, setTokenBalanceRaw] = useState<bigint | null>(null);
  const [balanceBeforeBuyRaw, setBalanceBeforeBuyRaw] = useState<bigint | null>(null);
  const [buyOpened, setBuyOpened] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PROJECT_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as TokenProject[];
      const robinhoodProjects = Array.isArray(parsed)
        ? parsed.filter((item) => item.chain === "robinhood")
        : [];
      setProjects(robinhoodProjects);
      if (robinhoodProjects[0]) {
        loadProject(robinhoodProjects[0], robinhoodProjects);
      }
    } catch {
      setStatus("Saved projects could not be loaded. You can still enter a launch manually.");
    }
    // Loading browser-only projects after hydration is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const provider = PROVIDERS[providerId];
  const selectedProject = useMemo(
    () => projects.find((item) => item.id === selectedProjectId) || null,
    [projects, selectedProjectId],
  );

  const refreshBalanceFor = useCallback(
    async (result: LaunchVerification, account: string, announce: boolean) => {
      if (!isAddress(account)) {
        if (announce) setStatus("Connect the wallet that will make the creator buy first.");
        return null;
      }

      setBalanceBusy(true);
      try {
        const client = createPublicClient({
          transport: http(ROBINHOOD_MAINNET.rpcUrls[0]),
        });
        const rawBalance = await client.readContract({
          address: result.contractAddress as Address,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [account as Address],
        });
        setTokenBalanceRaw(rawBalance);
        if (announce) {
          setStatus(
            `Wallet balance refreshed: ${formatTokenAmount(rawBalance, result.decimals)} ${result.symbol}.`,
          );
        }
        return rawBalance;
      } catch (error) {
        if (announce) setStatus(readError(error));
        return null;
      } finally {
        setBalanceBusy(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!buyOpened || !verification || !walletAddress) return;

    const refreshOnReturn = () => {
      void refreshBalanceFor(verification, walletAddress, false);
    };

    window.addEventListener("focus", refreshOnReturn);
    return () => window.removeEventListener("focus", refreshOnReturn);
  }, [buyOpened, refreshBalanceFor, verification, walletAddress]);

  function resetBuyState() {
    setVerification(null);
    setTokenBalanceRaw(null);
    setBalanceBeforeBuyRaw(null);
    setBuyOpened(false);
  }

  function loadProject(project: TokenProject, source = projects) {
    setSelectedProjectId(project.id);
    setName(project.name);
    setTicker(project.ticker);
    setDescription(project.description);
    setWebsite(project.websiteSlug ? `https://your-domain.com/${project.websiteSlug}` : "");
    setXHandle(project.xHandle);
    setTelegram(project.telegram);
    setArtwork(project.heroImage);
    setContractAddress(project.contractAddress);
    resetBuyState();
    if (source.length > 0) {
      setStatus(`${project.name || "Project"} loaded into the provider launch pack.`);
    }
  }

  function chooseProject(id: string) {
    if (!id) {
      setSelectedProjectId("");
      return;
    }
    const project = projects.find((item) => item.id === id);
    if (project) loadProject(project);
  }

  async function connectWallet() {
    if (!window.ethereum) {
      setStatus("Install an EVM wallet such as MetaMask or Robinhood Wallet first.");
      return;
    }
    setBusy(true);
    try {
      const accounts = (await window.ethereum.request({
        method: "eth_requestAccounts",
      })) as string[];
      if (!accounts[0]) throw new Error("The wallet returned no account.");

      try {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: ROBINHOOD_MAINNET.chainId }],
        });
      } catch (switchError) {
        if ((switchError as { code?: number }).code !== 4902) throw switchError;
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [ROBINHOOD_MAINNET],
        });
      }

      setWalletAddress(accounts[0]);
      if (!creatorWallet) setCreatorWallet(accounts[0]);
      if (verification) {
        await refreshBalanceFor(verification, accounts[0], false);
      }
      setStatus(
        "Wallet connected to Robinhood Chain Testnet. Launch and purchase approvals remain inside your wallet.",
      );
    } catch (error) {
      setStatus(readError(error));
    } finally {
      setBusy(false);
    }
  }

  async function copyValue(label: string, value: string) {
    if (!value.trim()) {
      setStatus(`${label} is empty.`);
      return;
    }
    await navigator.clipboard.writeText(value);
    setStatus(`${label} copied.`);
  }

  async function copyLaunchPack() {
    const launchPack = [
      `Provider: ${provider.name}`,
      "Network: Robinhood Chain Testnet (46630)",
      `Name: ${name}`,
      `Ticker: ${ticker.toUpperCase()}`,
      `Description: ${description}`,
      `Website: ${website}`,
      `X: ${xHandle}`,
      `Telegram: ${telegram}`,
      `Creator wallet: ${creatorWallet || walletAddress}`,
      `Immediate creator buy: ${immediateBuyEnabled ? `${developerBuy || "0"} ETH` : "Disabled"}`,
    ].join("\n");
    await navigator.clipboard.writeText(launchPack);
    setStatus(`${provider.name} launch pack copied. Review every field again on the provider site.`);
  }

  function downloadArtwork() {
    if (!artwork) {
      setStatus("No artwork is loaded for this project.");
      return;
    }
    const anchor = document.createElement("a");
    anchor.href = artwork;
    anchor.download = `${ticker.toLowerCase() || "token"}-artwork.png`;
    anchor.click();
    setStatus("Artwork download started.");
  }

  function openProvider() {
    if (!name.trim() || !ticker.trim() || !description.trim()) {
      setStatus("Add the token name, ticker and description before opening the provider.");
      return;
    }
    if (immediateBuyEnabled && !isPositiveAmount(developerBuy)) {
      setStatus("Enter an initial buy amount greater than zero, or turn immediate buy off.");
      return;
    }
    window.open(provider.launchUrl, "_blank", "noopener,noreferrer");
    setStatus(
      `${provider.name} opened in a new tab. Complete the launch, then return with the contract address so BUY TOKEN can activate.`,
    );
  }

  async function verifyLaunch() {
    if (!isAddress(contractAddress)) {
      setStatus("Enter a valid Robinhood Chain contract address.");
      return;
    }
    if (transactionHash && !/^0x[a-fA-F0-9]{64}$/.test(transactionHash)) {
      setStatus("The transaction hash must be 0x followed by 64 hexadecimal characters.");
      return;
    }

    setBusy(true);
    resetBuyState();
    try {
      const client = createPublicClient({
        transport: http(ROBINHOOD_MAINNET.rpcUrls[0]),
      });
      const address = contractAddress as Address;
      const bytecode = await client.getBytecode({ address });
      if (!bytecode || bytecode === "0x") {
        throw new Error("No deployed contract was found at that address on Robinhood Chain Testnet.");
      }

      const [tokenName, symbol, decimals, rawSupply] = await Promise.all([
        client.readContract({ address, abi: ERC20_ABI, functionName: "name" }),
        client.readContract({ address, abi: ERC20_ABI, functionName: "symbol" }),
        client.readContract({ address, abi: ERC20_ABI, functionName: "decimals" }),
        client.readContract({ address, abi: ERC20_ABI, functionName: "totalSupply" }),
      ]);

      let factoryConfirmed: boolean | null = provider.factory ? false : null;
      if (transactionHash) {
        const hash = transactionHash as Hash;
        const [transaction, receipt] = await Promise.all([
          client.getTransaction({ hash }),
          client.getTransactionReceipt({ hash }),
        ]);
        const expectedFactory = provider.factory?.toLowerCase();
        if (expectedFactory) {
          factoryConfirmed =
            transaction.to?.toLowerCase() === expectedFactory ||
            receipt.logs.some((log) => log.address.toLowerCase() === expectedFactory);
        }
      }

      const result: LaunchVerification = {
        provider: provider.id,
        projectId: selectedProjectId,
        contractAddress: address,
        transactionHash,
        tokenName,
        symbol,
        decimals,
        totalSupply: formatTokenAmount(rawSupply, decimals),
        factoryConfirmed,
        verifiedAt: new Date().toISOString(),
      };
      setVerification(result);
      saveVerification(result);

      if (walletAddress) {
        await refreshBalanceFor(result, walletAddress, false);
      }

      if (provider.id === "noxa" && transactionHash && !factoryConfirmed) {
        setStatus(
          "The ERC-20 is valid, but the transaction did not prove interaction with NOXA's factory. Immediate buy is blocked for safety.",
        );
      } else if (immediateBuyEnabled) {
        setStatus(
          `Token verified and saved. BUY TOKEN is now active with ${developerBuy || "0"} ETH prefilled.`,
        );
      } else if (provider.id === "noxa" && !transactionHash) {
        setStatus("The ERC-20 is valid. Add the launch transaction hash to verify the NOXA factory as well.");
      } else if (provider.id === "pons") {
        setStatus(
          "The ERC-20 is valid and saved. Pons has not published a factory address here, so provider-origin verification remains unavailable.",
        );
      } else {
        setStatus("Token and provider launch transaction verified and saved.");
      }
    } catch (error) {
      setStatus(readError(error));
    } finally {
      setBusy(false);
    }
  }

  async function openProviderForBuy() {
    if (!verification) {
      setStatus("Verify the newly launched token before buying.");
      return;
    }
    if (verification.transactionHash && verification.factoryConfirmed === false) {
      setStatus("Provider proof failed. The creator buy remains blocked for safety.");
      return;
    }
    if (!walletAddress) {
      setStatus("Connect the wallet that will make the creator buy.");
      return;
    }
    if (!isPositiveAmount(developerBuy)) {
      setStatus("Enter an initial buy amount greater than zero.");
      return;
    }

    setBalanceBeforeBuyRaw(tokenBalanceRaw);
    const buyPacket = [
      `Provider: ${provider.name}`,
      `Token contract: ${verification.contractAddress}`,
      `Creator buy: ${developerBuy} ETH`,
      `Buyer wallet: ${walletAddress}`,
      "Network: Robinhood Chain Testnet (46630)",
    ].join("\n");

    try {
      await navigator.clipboard.writeText(buyPacket);
    } catch {
      // The provider can still be opened when clipboard permission is unavailable.
    }

    setBuyOpened(true);
    window.open(provider.launchUrl, "_blank", "noopener,noreferrer");
    setStatus(
      `${provider.name} opened with the contract and buy amount copied. Approve the purchase on the official provider, then return here to see the balance.`,
    );
  }

  async function refreshPurchasedBalance() {
    if (!verification) {
      setStatus("Verify a token first.");
      return;
    }
    if (!walletAddress) {
      setStatus("Connect the buyer wallet first.");
      return;
    }
    await refreshBalanceFor(verification, walletAddress, true);
  }

  function saveVerification(result: LaunchVerification) {
    const rawLaunches = localStorage.getItem(LAUNCH_STORAGE_KEY);
    const launches = rawLaunches
      ? (JSON.parse(rawLaunches) as LaunchVerification[])
      : [];
    localStorage.setItem(
      LAUNCH_STORAGE_KEY,
      JSON.stringify([result, ...launches.filter((item) => item.contractAddress !== result.contractAddress)]),
    );

    if (!selectedProjectId) return;
    const rawProjects = localStorage.getItem(PROJECT_STORAGE_KEY);
    if (!rawProjects) return;
    const allProjects = JSON.parse(rawProjects) as TokenProject[];
    const updated = allProjects.map((item) =>
      item.id === selectedProjectId
        ? {
            ...item,
            contractAddress: result.contractAddress,
            status: "launched" as const,
            updatedAt: result.verifiedAt,
          }
        : item,
    );
    localStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(updated));
    setProjects(updated.filter((item) => item.chain === "robinhood"));
  }

  async function handleArtwork(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setStatus("Choose a PNG, JPG or WEBP image.");
      return;
    }
    if (file.size > 3_000_000) {
      setStatus("Keep provider artwork below 3 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setArtwork(String(reader.result || ""));
    reader.readAsDataURL(file);
  }

  const tokenBalance =
    verification && tokenBalanceRaw !== null
      ? formatTokenAmount(tokenBalanceRaw, verification.decimals)
      : "Not checked";

  const purchasedAmount =
    verification &&
    tokenBalanceRaw !== null &&
    balanceBeforeBuyRaw !== null &&
    tokenBalanceRaw > balanceBeforeBuyRaw
      ? formatTokenAmount(tokenBalanceRaw - balanceBeforeBuyRaw, verification.decimals)
      : null;

  const providerProofFailed = Boolean(
    verification?.transactionHash && verification.factoryConfirmed === false,
  );

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p>PRIVATE LAUNCH ADAPTERS</p>
          <h1>Robinhood provider launch desk</h1>
          <span>Launch through the provider, verify the token, then continue straight into the creator buy.</span>
        </div>
        <div className={styles.headerActions}>
          <Link href="/">Back to studio</Link>
          <button onClick={connectWallet} disabled={busy}>
            {walletAddress ? shortAddress(walletAddress) : busy ? "Connecting…" : "Connect wallet"}
          </button>
        </div>
      </header>

      <div className={styles.notice}>{status}</div>

      <ol className={styles.flowSteps}>
        <li className={styles.flowActive}><b>1</b><span>Launch through provider</span></li>
        <li className={verification ? styles.flowActive : ""}><b>2</b><span>Receive and verify token address</span></li>
        <li className={verification && immediateBuyEnabled && !providerProofFailed ? styles.flowActive : ""}><b>3</b><span>Activate BUY TOKEN</span></li>
        <li className={buyOpened ? styles.flowActive : ""}><b>4</b><span>Wallet confirmation</span></li>
        <li className={purchasedAmount ? styles.flowActive : ""}><b>5</b><span>Show purchased balance</span></li>
      </ol>

      <section className={styles.providerGrid}>
        {(Object.values(PROVIDERS) as (typeof PROVIDERS)[ProviderId][]).map((item) => (
          <button
            key={item.id}
            className={providerId === item.id ? styles.providerActive : styles.providerCard}
            onClick={() => {
              setProviderId(item.id);
              resetBuyState();
              setStatus(`${item.name} selected. Its official website will handle launch and purchase approvals.`);
            }}
          >
            <span>{item.name}</span>
            <b>{item.label}</b>
            <small>{item.description}</small>
          </button>
        ))}
      </section>

      <section className={styles.workspace}>
        <div className={styles.formPanel}>
          <div className={styles.sectionHeading}>
            <div><p>STEP 1</p><h2>Prepare launch data</h2></div>
            <span>{provider.name}</span>
          </div>

          <label>
            <span>Saved Robinhood project</span>
            <select value={selectedProjectId} onChange={(event) => chooseProject(event.target.value)}>
              <option value="">Manual launch pack</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name || "Untitled"} · ${project.ticker || "TOKEN"}
                </option>
              ))}
            </select>
          </label>

          <div className={styles.twoColumns}>
            <label><span>Name</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={32} /></label>
            <label><span>Ticker</span><input value={ticker} onChange={(event) => setTicker(event.target.value.replace(/[^a-zA-Z0-9]/g, "").slice(0, 10))} /></label>
          </div>

          <label><span>Description</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={5} /></label>
          <label><span>Website</span><input value={website} onChange={(event) => setWebsite(event.target.value)} placeholder="https://..." /></label>

          <div className={styles.twoColumns}>
            <label><span>X profile</span><input value={xHandle} onChange={(event) => setXHandle(event.target.value)} placeholder="x.com/..." /></label>
            <label><span>Telegram</span><input value={telegram} onChange={(event) => setTelegram(event.target.value)} placeholder="t.me/..." /></label>
          </div>

          <div className={styles.twoColumns}>
            <label><span>Creator wallet</span><input value={creatorWallet} onChange={(event) => setCreatorWallet(event.target.value)} placeholder="0x..." /></label>
            <label><span>Initial buy amount (ETH)</span><input value={developerBuy} onChange={(event) => setDeveloperBuy(event.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" /></label>
          </div>

          <label className={styles.toggleRow}>
            <input
              type="checkbox"
              checked={immediateBuyEnabled}
              onChange={(event) => setImmediateBuyEnabled(event.target.checked)}
            />
            <span>
              <b>Continue straight to BUY TOKEN</b>
              <small>After the contract is verified, activate the prefilled creator-buy handoff immediately.</small>
            </span>
          </label>

          <label className={styles.artworkBox}>
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleArtwork} />
            {artwork ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={artwork} alt="Launch artwork" />
            ) : <b>Upload or load token artwork</b>}
            <span>PNG, JPG or WEBP · provider limits may differ</span>
          </label>

          <div className={styles.actionGrid}>
            <button onClick={copyLaunchPack}>Copy launch pack</button>
            <button onClick={downloadArtwork} disabled={!artwork}>Download artwork</button>
            <button className={styles.launchButton} onClick={openProvider}>Launch on {provider.name} ↗</button>
          </div>

          <div className={styles.copyRows}>
            {[
              ["Name", name], ["Ticker", ticker.toUpperCase()], ["Description", description],
              ["Website", website], ["X profile", xHandle], ["Telegram", telegram],
              ["Creator wallet", creatorWallet || walletAddress],
              ["Initial buy", immediateBuyEnabled ? `${developerBuy || "0"} ETH` : "Disabled"],
            ].map(([label, value]) => (
              <button key={label} onClick={() => copyValue(label, value)}>
                <span>{label}</span><code>{value || "Not set"}</code><b>COPY</b>
              </button>
            ))}
          </div>
        </div>

        <aside className={styles.verifyPanel}>
          <div className={styles.sectionHeading}>
            <div><p>STEP 2</p><h2>Verify and buy</h2></div>
          </div>
          <p className={styles.explainer}>
            Return after the provider confirms the launch. Verification receives the contract address, saves it, and activates the creator-buy step.
          </p>

          <label><span>Token contract address</span><input value={contractAddress} onChange={(event) => setContractAddress(event.target.value.trim())} placeholder="0x..." /></label>
          <label><span>Launch transaction hash</span><input value={transactionHash} onChange={(event) => setTransactionHash(event.target.value.trim())} placeholder="0x..." /></label>

          <button className={styles.verifyButton} onClick={verifyLaunch} disabled={busy}>
            {busy ? "Checking chain…" : "Verify, save and activate buy"}
          </button>

          <div className={styles.verificationMode}>
            <span>Provider verification</span>
            <b>{provider.factory ? "Factory + ERC-20" : "ERC-20 only"}</b>
            {provider.factory && <code>{shortAddress(provider.factory)}</code>}
          </div>

          {verification && (
            <>
              <div className={styles.resultCard}>
                <p>VERIFIED TOKEN</p>
                <h3>{verification.tokenName}</h3>
                <dl>
                  <div><dt>Symbol</dt><dd>${verification.symbol}</dd></div>
                  <div><dt>Supply</dt><dd>{verification.totalSupply}</dd></div>
                  <div><dt>Decimals</dt><dd>{verification.decimals}</dd></div>
                  <div><dt>Contract</dt><dd>{shortAddress(verification.contractAddress)}</dd></div>
                  <div><dt>Provider proof</dt><dd>{verification.factoryConfirmed === null ? "Not published" : verification.factoryConfirmed ? "Confirmed" : "Not confirmed"}</dd></div>
                </dl>
                <a href={`${ROBINHOOD_MAINNET.blockExplorerUrls[0]}/address/${verification.contractAddress}`} target="_blank" rel="noreferrer">Open contract in explorer ↗</a>
              </div>

              <div className={styles.buyCard}>
                <div className={styles.buyCardHeading}>
                  <div><p>STEP 3</p><h3>Buy token immediately</h3></div>
                  <span>{providerProofFailed ? "BLOCKED" : immediateBuyEnabled ? "READY" : "OFF"}</span>
                </div>
                <dl>
                  <div><dt>Prefilled buy</dt><dd>{developerBuy || "0"} ETH</dd></div>
                  <div><dt>Buyer wallet</dt><dd>{walletAddress ? shortAddress(walletAddress) : "Connect wallet"}</dd></div>
                  <div><dt>Current balance</dt><dd>{tokenBalance} {verification.symbol}</dd></div>
                  {purchasedAmount && <div><dt>Newly detected</dt><dd>+{purchasedAmount} {verification.symbol}</dd></div>}
                </dl>
                <button
                  className={styles.buyButton}
                  onClick={openProviderForBuy}
                  disabled={!immediateBuyEnabled || !walletAddress || !isPositiveAmount(developerBuy) || providerProofFailed}
                >
                  OPEN {provider.name.toUpperCase()} & BUY {developerBuy || "0"} ETH ↗
                </button>
                <button className={styles.refreshButton} onClick={refreshPurchasedBalance} disabled={balanceBusy || !walletAddress}>
                  {balanceBusy ? "Checking balance…" : "Refresh purchased balance"}
                </button>
                <small>
                  Wallet approval happens on the official provider. The address and amount are copied for the handoff; no undocumented router call is invented.
                </small>
              </div>
            </>
          )}

          <div className={styles.warning}>
            <b>Before signing</b>
            <span>Confirm chain ID 46630, launch fee, creator buy, slippage, wallet and every approval. A separate post-launch purchase is fast but is not atomic.</span>
          </div>
          {selectedProject && <small className={styles.selectedNote}>Saving into: {selectedProject.name} · ${selectedProject.ticker}</small>}
        </aside>
      </section>
    </main>
  );
}
