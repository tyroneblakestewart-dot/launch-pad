"use client";

import Link from "next/link";
import { ChangeEvent, useEffect, useMemo, useState } from "react";
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
    label: "Documented factory verification",
    description:
      "Prepare the launch pack here, complete the wallet-signed launch on NOXA, then verify that the transaction touched NOXA's published Robinhood launch factory.",
    factory: NOXA_FACTORY,
  },
  pons: {
    id: "pons" as const,
    name: "Pons Family",
    launchUrl: "https://pons.family/launchpad/create",
    label: "Token and transaction verification",
    description:
      "Prepare the launch pack here, complete the launch through Pons, then verify the resulting ERC-20 and save it back into your private studio.",
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

function formatSupply(value: bigint, decimals: number): string {
  const divisor = 10n ** BigInt(decimals);
  const whole = value / divisor;
  const remainder = value % divisor;
  if (remainder === 0n) return whole.toLocaleString("en-GB");
  const fractional = remainder.toString().padStart(decimals, "0").slice(0, 6);
  return `${whole.toLocaleString("en-GB")}.${fractional.replace(/0+$/, "")}`;
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
  const [artwork, setArtwork] = useState("");
  const [contractAddress, setContractAddress] = useState("");
  const [transactionHash, setTransactionHash] = useState("");
  const [walletAddress, setWalletAddress] = useState("");
  const [status, setStatus] = useState(
    "Choose a saved Robinhood Chain project or enter the launch details manually.",
  );
  const [busy, setBusy] = useState(false);
  const [verification, setVerification] = useState<LaunchVerification | null>(null);

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
    setVerification(null);
    if (source.length > 0) {
      setStatus(`${project.name || "Project"} loaded into the provider launch pack.`);
    }
  }

  function chooseProject(id: string) {
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
      setStatus("Wallet connected to Robinhood Chain. Provider launches still open on the official external site.");
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
      `Network: Robinhood Chain (4663)`,
      `Name: ${name}`,
      `Ticker: ${ticker.toUpperCase()}`,
      `Description: ${description}`,
      `Website: ${website}`,
      `X: ${xHandle}`,
      `Telegram: ${telegram}`,
      `Creator wallet: ${creatorWallet || walletAddress}`,
      `Developer buy: ${developerBuy || "0"} ETH`,
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
    window.open(provider.launchUrl, "_blank", "noopener,noreferrer");
    setStatus(
      `${provider.name} opened in a new tab. Copy the prepared fields and inspect the wallet transaction before signing.`,
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
    setVerification(null);
    try {
      const client = createPublicClient({
        transport: http(ROBINHOOD_MAINNET.rpcUrls[0]),
      });
      const address = contractAddress as Address;
      const bytecode = await client.getBytecode({ address });
      if (!bytecode || bytecode === "0x") {
        throw new Error("No deployed contract was found at that address on Robinhood Chain.");
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
        totalSupply: formatSupply(rawSupply, decimals),
        factoryConfirmed,
        verifiedAt: new Date().toISOString(),
      };
      setVerification(result);
      saveVerification(result);

      if (provider.id === "noxa" && transactionHash && !factoryConfirmed) {
        setStatus("The ERC-20 is valid, but the supplied transaction did not prove interaction with NOXA's published factory.");
      } else if (provider.id === "noxa" && !transactionHash) {
        setStatus("The ERC-20 is valid. Add the launch transaction hash to verify the NOXA factory as well.");
      } else if (provider.id === "pons") {
        setStatus("The ERC-20 is valid and saved. Pons has not published a factory address here, so provider-origin verification remains unavailable.");
      } else {
        setStatus("Token and provider launch transaction verified and saved.");
      }
    } catch (error) {
      setStatus(readError(error));
    } finally {
      setBusy(false);
    }
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

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p>PRIVATE LAUNCH ADAPTERS</p>
          <h1>Robinhood provider launch desk</h1>
          <span>Prepare once. Launch through the official provider. Verify before publishing.</span>
        </div>
        <div className={styles.headerActions}>
          <Link href="/">Back to studio</Link>
          <button onClick={connectWallet} disabled={busy}>
            {walletAddress ? shortAddress(walletAddress) : busy ? "Connecting…" : "Connect wallet"}
          </button>
        </div>
      </header>

      <div className={styles.notice}>{status}</div>

      <section className={styles.providerGrid}>
        {(Object.values(PROVIDERS) as (typeof PROVIDERS)[ProviderId][]).map((item) => (
          <button
            key={item.id}
            className={providerId === item.id ? styles.providerActive : styles.providerCard}
            onClick={() => {
              setProviderId(item.id);
              setVerification(null);
              setStatus(`${item.name} selected. Its official website will handle the launch transaction.`);
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
            <label><span>Developer buy (ETH)</span><input value={developerBuy} onChange={(event) => setDeveloperBuy(event.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" /></label>
          </div>

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
            <button className={styles.launchButton} onClick={openProvider}>Open {provider.name} ↗</button>
          </div>

          <div className={styles.copyRows}>
            {[
              ["Name", name], ["Ticker", ticker.toUpperCase()], ["Description", description],
              ["Website", website], ["X profile", xHandle], ["Telegram", telegram],
              ["Creator wallet", creatorWallet || walletAddress],
            ].map(([label, value]) => (
              <button key={label} onClick={() => copyValue(label, value)}>
                <span>{label}</span><code>{value || "Not set"}</code><b>COPY</b>
              </button>
            ))}
          </div>
        </div>

        <aside className={styles.verifyPanel}>
          <div className={styles.sectionHeading}>
            <div><p>STEP 2</p><h2>Verify after launch</h2></div>
          </div>
          <p className={styles.explainer}>
            Return here after the provider confirms the launch. This checks the contract directly on Robinhood Chain before saving it into your project.
          </p>

          <label><span>Token contract address</span><input value={contractAddress} onChange={(event) => setContractAddress(event.target.value.trim())} placeholder="0x..." /></label>
          <label><span>Launch transaction hash</span><input value={transactionHash} onChange={(event) => setTransactionHash(event.target.value.trim())} placeholder="0x..." /></label>

          <button className={styles.verifyButton} onClick={verifyLaunch} disabled={busy}>
            {busy ? "Checking chain…" : "Verify and save launch"}
          </button>

          <div className={styles.verificationMode}>
            <span>Provider verification</span>
            <b>{provider.factory ? "Factory + ERC-20" : "ERC-20 only"}</b>
            {provider.factory && <code>{shortAddress(provider.factory)}</code>}
          </div>

          {verification && (
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
              <a href={`https://robinhoodchain.blockscout.com/address/${verification.contractAddress}`} target="_blank" rel="noreferrer">Open contract in Blockscout ↗</a>
            </div>
          )}

          <div className={styles.warning}>
            <b>Before signing</b>
            <span>Confirm chain ID 4663, launch fee, developer buy, slippage, creator wallet and every approval in your wallet. This app never signs for you.</span>
          </div>
          {selectedProject && <small className={styles.selectedNote}>Saving into: {selectedProject.name} · ${selectedProject.ticker}</small>}
        </aside>
      </section>
    </main>
  );
}
