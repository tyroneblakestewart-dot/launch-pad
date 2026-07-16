"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  createPublicClient,
  encodeFunctionData,
  formatUnits,
  http,
  isAddress,
  parseAbi,
  type Address,
  type Hash,
} from "viem";
import { ROBINHOOD_TESTNET } from "@/lib/chains";
import type { TokenProject } from "@/lib/types";
import styles from "./token-allocation-desk.module.css";

const PROJECT_STORAGE_KEY = "private-meme-token-studio-projects-v1";
const ALLOCATION_STORAGE_KEY = "private-meme-token-studio-allocation-plans-v1";

const ERC20_ABI = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);

const publicClient = createPublicClient({
  transport: http(ROBINHOOD_TESTNET.rpcUrls[0]),
});

type AllocationKey = "liquidity" | "community" | "team" | "reserve";
type DistributionKey = Exclude<AllocationKey, "liquidity">;

type EthereumProvider = {
  request: (args: {
    method: string;
    params?: unknown[] | Record<string, unknown>;
  }) => Promise<unknown>;
};

type SavedAllocationPlan = {
  projectId: string;
  contractAddress: string;
  tokenName: string;
  symbol: string;
  decimals: number;
  totalSupplyRaw: string;
  ownerWallet: string;
  allocations: Array<{
    key: AllocationKey;
    percent: string;
    amountRaw: string;
    amountFormatted: string;
    destination: string;
    transactionHash: string;
  }>;
  liquidity: {
    route: string;
    nativeAmount: string;
  };
  updatedAt: string;
};

const ALLOCATIONS: Array<{
  key: AllocationKey;
  label: string;
  description: string;
}> = [
  {
    key: "liquidity",
    label: "Liquidity / public trading",
    description: "Keep this allocation in the connected wallet until a verified pool transaction is ready.",
  },
  {
    key: "community",
    label: "Community and rewards",
    description: "A separate community or rewards wallet makes the allocation easier to track.",
  },
  {
    key: "team",
    label: "Team",
    description: "Use a dedicated treasury now; a vesting contract should replace it before a public launch.",
  },
  {
    key: "reserve",
    label: "Marketing / reserve",
    description: "Keep reserve funds separate from the creator and liquidity wallets.",
  },
];

function getEthereum(): EthereumProvider | undefined {
  return (window as Window & { ethereum?: EthereumProvider }).ethereum;
}

function readError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "shortMessage" in error) {
    return String((error as { shortMessage: unknown }).shortMessage);
  }
  return "The wallet or network action could not be completed.";
}

function shortAddress(value: string): string {
  return value.length > 13 ? `${value.slice(0, 7)}…${value.slice(-5)}` : value;
}

function cleanPercent(value: string): string {
  const cleaned = value.replace(/[^0-9.]/g, "");
  const [whole, ...fractionParts] = cleaned.split(".");
  if (fractionParts.length === 0) return whole.slice(0, 3);
  return `${whole.slice(0, 3)}.${fractionParts.join("").slice(0, 2)}`;
}

function percentToBasisPoints(value: string): bigint {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0n;
  return BigInt(Math.round(parsed * 100));
}

function formatTokenAmount(value: bigint, decimals: number): string {
  const formatted = formatUnits(value, decimals);
  const numeric = Number(formatted);
  if (!Number.isFinite(numeric)) return formatted;
  return new Intl.NumberFormat("en-GB", {
    maximumFractionDigits: 4,
  }).format(numeric);
}

export function TokenAllocationDesk() {
  const [projects, setProjects] = useState<TokenProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [contractAddress, setContractAddress] = useState("");
  const [walletAddress, setWalletAddress] = useState("");
  const [tokenName, setTokenName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [decimals, setDecimals] = useState(18);
  const [totalSupplyRaw, setTotalSupplyRaw] = useState("0");
  const [walletBalanceRaw, setWalletBalanceRaw] = useState("0");
  const [percentages, setPercentages] = useState<Record<AllocationKey, string>>({
    liquidity: "70",
    community: "15",
    team: "10",
    reserve: "5",
  });
  const [destinations, setDestinations] = useState<Record<DistributionKey, string>>({
    community: "",
    team: "",
    reserve: "",
  });
  const [transactionHashes, setTransactionHashes] = useState<
    Partial<Record<DistributionKey, string>>
  >({});
  const [liquidityRoute, setLiquidityRoute] = useState("verified-router-pending");
  const [nativeLiquidityAmount, setNativeLiquidityAmount] = useState("0.1");
  const [acknowledged, setAcknowledged] = useState(false);
  const [status, setStatus] = useState(
    "Load a deployed Robinhood Testnet token, confirm the allocation totals, then distribute one wallet-approved transfer at a time.",
  );
  const [busyAction, setBusyAction] = useState("");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PROJECT_STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as TokenProject[]) : [];
      const deployed = Array.isArray(parsed)
        ? parsed.filter((project) => project.chain === "robinhood" && isAddress(project.contractAddress))
        : [];
      setProjects(deployed);
      if (deployed[0]) {
        setSelectedProjectId(deployed[0].id);
        setContractAddress(deployed[0].contractAddress);
        loadSavedPlan(deployed[0].contractAddress);
      }
    } catch {
      setStatus("Saved projects could not be loaded. Paste the token contract address manually.");
    }
    // Browser storage is intentionally loaded once after hydration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) || null,
    [projects, selectedProjectId],
  );

  const totalBasisPoints = useMemo(
    () =>
      Object.values(percentages).reduce(
        (total, percentage) => total + percentToBasisPoints(percentage),
        0n,
      ),
    [percentages],
  );

  const allocationIsValid = totalBasisPoints === 10_000n;
  const totalSupply = BigInt(totalSupplyRaw || "0");
  const walletBalance = BigInt(walletBalanceRaw || "0");

  function allocationAmount(key: AllocationKey): bigint {
    return (totalSupply * percentToBasisPoints(percentages[key])) / 10_000n;
  }

  function loadSavedPlan(address: string) {
    try {
      const raw = localStorage.getItem(ALLOCATION_STORAGE_KEY);
      const plans = raw ? (JSON.parse(raw) as SavedAllocationPlan[]) : [];
      const saved = plans.find(
        (plan) => plan.contractAddress.toLowerCase() === address.toLowerCase(),
      );
      if (!saved) return;

      const savedPercentages = { ...percentages };
      const savedDestinations = { ...destinations };
      const savedHashes: Partial<Record<DistributionKey, string>> = {};
      for (const allocation of saved.allocations) {
        savedPercentages[allocation.key] = allocation.percent;
        if (allocation.key !== "liquidity") {
          savedDestinations[allocation.key] = allocation.destination;
          if (allocation.transactionHash) savedHashes[allocation.key] = allocation.transactionHash;
        }
      }
      setPercentages(savedPercentages);
      setDestinations(savedDestinations);
      setTransactionHashes(savedHashes);
      setLiquidityRoute(saved.liquidity.route);
      setNativeLiquidityAmount(saved.liquidity.nativeAmount);
    } catch {
      setStatus("A saved allocation plan exists but could not be read.");
    }
  }

  function chooseProject(projectId: string) {
    setSelectedProjectId(projectId);
    const project = projects.find((item) => item.id === projectId);
    if (!project) return;
    setContractAddress(project.contractAddress);
    setTokenName("");
    setSymbol("");
    setTotalSupplyRaw("0");
    setWalletBalanceRaw("0");
    loadSavedPlan(project.contractAddress);
    setStatus(`${project.name} selected. Load its on-chain token data before distributing.`);
  }

  async function connectWallet() {
    const ethereum = getEthereum();
    if (!ethereum) {
      setStatus("Install an EVM wallet such as MetaMask or Robinhood Wallet first.");
      return;
    }

    setBusyAction("wallet");
    try {
      const accounts = (await ethereum.request({ method: "eth_requestAccounts" })) as string[];
      if (!accounts[0] || !isAddress(accounts[0])) throw new Error("The wallet returned no valid account.");

      try {
        await ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: ROBINHOOD_TESTNET.chainId }],
        });
      } catch (switchError) {
        if ((switchError as { code?: number }).code !== 4902) throw switchError;
        await ethereum.request({
          method: "wallet_addEthereumChain",
          params: [ROBINHOOD_TESTNET],
        });
      }

      setWalletAddress(accounts[0]);
      setStatus("Wallet connected to Robinhood Chain Testnet. Every distribution still needs a separate wallet confirmation.");
      if (isAddress(contractAddress)) await loadToken(accounts[0]);
    } catch (error) {
      setStatus(readError(error));
    } finally {
      setBusyAction("");
    }
  }

  async function loadToken(account = walletAddress) {
    if (!isAddress(contractAddress)) {
      setStatus("Enter a valid deployed token contract address.");
      return;
    }

    setBusyAction("token");
    try {
      const address = contractAddress as Address;
      const bytecode = await publicClient.getBytecode({ address });
      if (!bytecode || bytecode === "0x") {
        throw new Error("No deployed contract was found at this address on Robinhood Chain Testnet.");
      }

      const [nameResult, symbolResult, decimalsResult, supplyResult] = await Promise.all([
        publicClient.readContract({ address, abi: ERC20_ABI, functionName: "name" }),
        publicClient.readContract({ address, abi: ERC20_ABI, functionName: "symbol" }),
        publicClient.readContract({ address, abi: ERC20_ABI, functionName: "decimals" }),
        publicClient.readContract({ address, abi: ERC20_ABI, functionName: "totalSupply" }),
      ]);

      let balanceResult = 0n;
      if (isAddress(account)) {
        balanceResult = await publicClient.readContract({
          address,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [account as Address],
        });
      }

      setTokenName(nameResult);
      setSymbol(symbolResult);
      setDecimals(decimalsResult);
      setTotalSupplyRaw(supplyResult.toString());
      setWalletBalanceRaw(balanceResult.toString());
      loadSavedPlan(address);
      setStatus(`${nameResult} loaded from Robinhood Chain Testnet. Review the calculated amounts before saving or sending.`);
    } catch (error) {
      setStatus(readError(error));
    } finally {
      setBusyAction("");
    }
  }

  async function refreshBalance(account = walletAddress) {
    if (!isAddress(contractAddress) || !isAddress(account)) return;
    const balance = await publicClient.readContract({
      address: contractAddress as Address,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [account as Address],
    });
    setWalletBalanceRaw(balance.toString());
  }

  function updatePercentage(key: AllocationKey, value: string) {
    setPercentages((current) => ({ ...current, [key]: cleanPercent(value) }));
    setTransactionHashes({});
  }

  function buildPlan(): SavedAllocationPlan {
    return {
      projectId: selectedProjectId,
      contractAddress,
      tokenName,
      symbol,
      decimals,
      totalSupplyRaw,
      ownerWallet: walletAddress,
      allocations: ALLOCATIONS.map((allocation) => {
        const amount = allocationAmount(allocation.key);
        const destination =
          allocation.key === "liquidity" ? walletAddress : destinations[allocation.key];
        const transactionHash =
          allocation.key === "liquidity" ? "" : transactionHashes[allocation.key] || "";
        return {
          key: allocation.key,
          percent: percentages[allocation.key],
          amountRaw: amount.toString(),
          amountFormatted: formatTokenAmount(amount, decimals),
          destination,
          transactionHash,
        };
      }),
      liquidity: {
        route: liquidityRoute,
        nativeAmount: nativeLiquidityAmount,
      },
      updatedAt: new Date().toISOString(),
    };
  }

  function validatePlan(): boolean {
    if (!isAddress(contractAddress) || !tokenName || totalSupply === 0n) {
      setStatus("Load valid on-chain token data before saving the allocation plan.");
      return false;
    }
    if (!allocationIsValid) {
      setStatus("The allocation percentages must total exactly 100%.");
      return false;
    }
    return true;
  }

  function savePlan() {
    if (!validatePlan()) return;
    const plan = buildPlan();
    const raw = localStorage.getItem(ALLOCATION_STORAGE_KEY);
    const plans = raw ? (JSON.parse(raw) as SavedAllocationPlan[]) : [];
    const updated = [
      plan,
      ...plans.filter(
        (item) => item.contractAddress.toLowerCase() !== contractAddress.toLowerCase(),
      ),
    ];
    localStorage.setItem(ALLOCATION_STORAGE_KEY, JSON.stringify(updated));
    setStatus("Allocation plan saved locally. No tokens were moved by saving it.");
  }

  function downloadPlan() {
    if (!validatePlan()) return;
    const plan = buildPlan();
    const blob = new Blob([JSON.stringify(plan, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${symbol.toLowerCase() || "token"}-allocation-plan.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus("Allocation record downloaded. Keep it with the launch documentation.");
  }

  async function sendDistribution(key: DistributionKey) {
    const ethereum = getEthereum();
    if (!ethereum) {
      setStatus("Connect an EVM wallet before sending tokens.");
      return;
    }
    if (!acknowledged) {
      setStatus("Confirm the irreversible-transfer warning before distributing tokens.");
      return;
    }
    if (!allocationIsValid || !tokenName) {
      setStatus("Load the token and make the allocation total exactly 100% first.");
      return;
    }
    if (!isAddress(walletAddress) || !isAddress(contractAddress)) {
      setStatus("Connect the token-holding wallet and load the contract first.");
      return;
    }

    const destination = destinations[key];
    if (!isAddress(destination)) {
      setStatus(`Enter a valid ${key} destination wallet.`);
      return;
    }
    if (destination.toLowerCase() === walletAddress.toLowerCase()) {
      setStatus("Use a separate destination wallet; sending back to the connected wallet would not distribute anything.");
      return;
    }

    const amount = allocationAmount(key);
    if (amount <= 0n) {
      setStatus("The selected allocation amount is zero.");
      return;
    }
    if (amount > walletBalance) {
      setStatus("The connected wallet does not currently hold enough tokens for this allocation.");
      return;
    }

    setBusyAction(key);
    try {
      const data = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [destination as Address, amount],
      });
      const hash = (await ethereum.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: walletAddress,
            to: contractAddress,
            data,
          },
        ],
      })) as string;

      await publicClient.waitForTransactionReceipt({ hash: hash as Hash });
      setTransactionHashes((current) => ({ ...current, [key]: hash }));
      await refreshBalance();
      setStatus(`${formatTokenAmount(amount, decimals)} ${symbol} sent to the ${key} wallet and confirmed on-chain.`);
    } catch (error) {
      setStatus(readError(error));
    } finally {
      setBusyAction("");
    }
  }

  const totalPercent = Number(totalBasisPoints) / 100;
  const explorer = ROBINHOOD_TESTNET.blockExplorerUrls[0];

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p>PRIVATE TOKEN OPERATIONS</p>
          <h1>Allocation and distribution desk</h1>
          <span>Plan the supply, save a record, then approve each real ERC-20 transfer yourself.</span>
        </div>
        <div className={styles.headerActions}>
          <Link href="/">Back to studio</Link>
          <Link href="/providers">Provider desk</Link>
          <button onClick={connectWallet} disabled={Boolean(busyAction)}>
            {walletAddress ? shortAddress(walletAddress) : busyAction === "wallet" ? "Connecting…" : "Connect wallet"}
          </button>
        </div>
      </header>

      <div className={styles.notice}>{status}</div>

      <section className={styles.networkBar}>
        <div><span>Network</span><b>Robinhood Chain Testnet</b></div>
        <div><span>Chain ID</span><b>46630</b></div>
        <div><span>Mode</span><b>Manual wallet approval</b></div>
        <div><span>Liquidity</span><b>Safe-mode locked</b></div>
      </section>

      <section className={styles.tokenLoader}>
        <div className={styles.sectionHeading}>
          <div><p>STEP 1</p><h2>Load the deployed token</h2></div>
          {selectedProject && <span>{selectedProject.name} · ${selectedProject.ticker}</span>}
        </div>

        <div className={styles.loaderGrid}>
          <label>
            <span>Saved Robinhood project</span>
            <select value={selectedProjectId} onChange={(event) => chooseProject(event.target.value)}>
              <option value="">Manual contract</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>{project.name} · ${project.ticker}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Token contract address</span>
            <input
              value={contractAddress}
              onChange={(event) => {
                setSelectedProjectId("");
                setContractAddress(event.target.value.trim());
                setTokenName("");
              }}
              placeholder="0x..."
            />
          </label>
          <button onClick={() => loadToken()} disabled={Boolean(busyAction)}>
            {busyAction === "token" ? "Reading chain…" : "Load token data"}
          </button>
        </div>

        <div className={styles.tokenStats}>
          <div><span>Token</span><b>{tokenName || "Not loaded"}</b></div>
          <div><span>Symbol</span><b>{symbol ? `$${symbol}` : "—"}</b></div>
          <div><span>Total supply</span><b>{totalSupply > 0n ? formatTokenAmount(totalSupply, decimals) : "—"}</b></div>
          <div><span>Connected balance</span><b>{walletAddress && tokenName ? `${formatTokenAmount(walletBalance, decimals)} ${symbol}` : "Connect wallet"}</b></div>
        </div>
      </section>

      <section className={styles.workspace}>
        <div className={styles.planPanel}>
          <div className={styles.sectionHeading}>
            <div><p>STEP 2</p><h2>Set the allocation</h2></div>
            <span className={allocationIsValid ? styles.totalGood : styles.totalBad}>
              Total {totalPercent.toFixed(2)}%
            </span>
          </div>

          <div className={styles.allocationList}>
            {ALLOCATIONS.map((allocation) => {
              const amount = allocationAmount(allocation.key);
              return (
                <article key={allocation.key} className={styles.allocationCard}>
                  <div className={styles.allocationTop}>
                    <div>
                      <h3>{allocation.label}</h3>
                      <p>{allocation.description}</p>
                    </div>
                    <label>
                      <span>Percent</span>
                      <div className={styles.percentInput}>
                        <input
                          value={percentages[allocation.key]}
                          onChange={(event) => updatePercentage(allocation.key, event.target.value)}
                          inputMode="decimal"
                        />
                        <b>%</b>
                      </div>
                    </label>
                  </div>
                  <div className={styles.amountRow}>
                    <span>Calculated amount</span>
                    <b>{tokenName ? `${formatTokenAmount(amount, decimals)} ${symbol}` : "Load token first"}</b>
                  </div>
                  {allocation.key === "liquidity" ? (
                    <div className={styles.holdNotice}>Held in the connected wallet until a verified liquidity transaction is available.</div>
                  ) : (
                    <label className={styles.destinationField}>
                      <span>{allocation.label} destination wallet</span>
                      <input
                        value={destinations[allocation.key]}
                        onChange={(event) => {
                          setDestinations((current) => ({ ...current, [allocation.key]: event.target.value.trim() }));
                          setTransactionHashes((current) => ({ ...current, [allocation.key]: undefined }));
                        }}
                        placeholder="0x..."
                      />
                    </label>
                  )}
                </article>
              );
            })}
          </div>

          {!allocationIsValid && (
            <div className={styles.errorBox}>Percentages must equal exactly 100% before any transfer is enabled.</div>
          )}
        </div>

        <aside className={styles.distributionPanel}>
          <div className={styles.sectionHeading}>
            <div><p>STEP 3</p><h2>Distribute safely</h2></div>
          </div>
          <p className={styles.explainer}>
            Liquidity tokens stay where they are. Community, team and reserve allocations can be sent individually after you inspect each wallet prompt.
          </p>

          {(["community", "team", "reserve"] as DistributionKey[]).map((key) => {
            const hash = transactionHashes[key];
            return (
              <div className={styles.transferRow} key={key}>
                <div>
                  <span>{key}</span>
                  <b>{tokenName ? `${formatTokenAmount(allocationAmount(key), decimals)} ${symbol}` : "—"}</b>
                  <small>{destinations[key] ? shortAddress(destinations[key]) : "Destination not set"}</small>
                </div>
                {hash ? (
                  <a href={`${explorer}/tx/${hash}`} target="_blank" rel="noreferrer">Confirmed ↗</a>
                ) : (
                  <button
                    onClick={() => sendDistribution(key)}
                    disabled={Boolean(busyAction) || !allocationIsValid || !tokenName}
                  >
                    {busyAction === key ? "Confirming…" : "Send allocation"}
                  </button>
                )}
              </div>
            );
          })}

          <label className={styles.confirmation}>
            <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
            <span>I checked every destination. ERC-20 transfers are irreversible and each send requires my wallet approval.</span>
          </label>

          <div className={styles.warning}>
            <b>Public-launch warning</b>
            <span>This treasury-wallet distribution is suitable for personal testnet use. Team tokens should use an audited vesting contract before public mainnet use.</span>
          </div>
        </aside>
      </section>

      <section className={styles.bottomGrid}>
        <div className={styles.liquidityPanel}>
          <div className={styles.sectionHeading}>
            <div><p>STEP 4</p><h2>Prepare liquidity</h2></div>
            <span>Execution locked</span>
          </div>
          <div className={styles.twoColumns}>
            <label>
              <span>Liquidity route</span>
              <select value={liquidityRoute} onChange={(event) => setLiquidityRoute(event.target.value)}>
                <option value="verified-router-pending">Verified router pending</option>
                <option value="third-party-provider">Third-party provider handoff</option>
                <option value="custom-audited-router">Custom audited router</option>
              </select>
            </label>
            <label>
              <span>Planned test ETH</span>
              <input
                value={nativeLiquidityAmount}
                onChange={(event) => setNativeLiquidityAmount(event.target.value.replace(/[^0-9.]/g, ""))}
                inputMode="decimal"
              />
            </label>
          </div>
          <div className={styles.liquiditySummary}>
            <div><span>Token side</span><b>{tokenName ? `${formatTokenAmount(allocationAmount("liquidity"), decimals)} ${symbol}` : "—"}</b></div>
            <div><span>Native side</span><b>{nativeLiquidityAmount || "0"} test ETH</b></div>
          </div>
          <button disabled>CREATE LIQUIDITY — ROUTER NOT CONFIGURED</button>
          <p>No router call is invented here. This button will unlock only after a documented Robinhood Testnet DEX/router address and ABI are verified.</p>
        </div>

        <div className={styles.recordPanel}>
          <div className={styles.sectionHeading}>
            <div><p>STEP 5</p><h2>Save the launch record</h2></div>
          </div>
          <p>Saving records the percentages, destinations, planned liquidity and confirmed distribution transaction hashes. It never signs or moves tokens.</p>
          <div className={styles.recordActions}>
            <button onClick={savePlan}>Save allocation plan</button>
            <button onClick={downloadPlan}>Download JSON record</button>
          </div>
          {isAddress(contractAddress) && (
            <a href={`${explorer}/address/${contractAddress}`} target="_blank" rel="noreferrer">Open token contract in explorer ↗</a>
          )}
        </div>
      </section>
    </main>
  );
}
