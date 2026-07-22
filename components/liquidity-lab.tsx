"use client";

import { useEffect, useMemo, useState } from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  formatEther,
  formatUnits,
  http,
  isAddress,
  parseAbi,
  parseEther,
  parseUnits,
  type Address,
} from "viem";
import { ROBINHOOD_TESTNET, ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL } from "@/lib/chains";
import { getInjectedEvmProvider } from "@/lib/wallet-provider";
import styles from "./liquidity-lab.module.css";

const HOODLUMS_TEST_AMM_ABI = parseAbi([
  "function addLiquidity(uint256 tokenDesired,uint256 tokenMin,uint256 ethMin,uint256 minLp,uint256 deadline) payable returns (uint256,uint256,uint256)",
  "function reserveToken() view returns (uint112)",
  "function reserveEth() view returns (uint112)",
  "function balanceOf(address owner) view returns (uint256)",
]);
const HOODLUMS = "0x3bf7447cd055f1475a8b09090c7b062abc9d3798" as Address;
const STORAGE_KEY = "hoodlums-test-liquidity-pool-v1";
const ERC20_ABI = parseAbi([
  "function approve(address spender,uint256 amount) returns (bool)",
  "function allowance(address owner,address spender) view returns (uint256)",
  "function decimals() view returns (uint8)",
]);

const chain = defineChain({
  id: ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL,
  name: ROBINHOOD_TESTNET.chainName,
  nativeCurrency: ROBINHOOD_TESTNET.nativeCurrency,
  rpcUrls: { default: { http: [...ROBINHOOD_TESTNET.rpcUrls] } },
  blockExplorers: { default: { name: "Robinhood Testnet Explorer", url: ROBINHOOD_TESTNET.blockExplorerUrls[0] } },
  testnet: true,
});

function deadline() {
  return BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
}

export function LiquidityLab() {
  const [account, setAccount] = useState<Address | null>(null);
  const [pool, setPool] = useState<Address | null>(null);
  const [poolInput, setPoolInput] = useState("");
  const [tokenAmount, setTokenAmount] = useState("10000000");
  const [ethAmount, setEthAmount] = useState("0.1");
  const [status, setStatus] = useState("Connect the confirmed wallet to begin.");
  const [busy, setBusy] = useState(false);
  const [reserves, setReserves] = useState({ token: "0", eth: "0", lp: "0" });

  const publicClient = useMemo(
    () => createPublicClient({ chain, transport: http(ROBINHOOD_TESTNET.rpcUrls[0]) }),
    [],
  );

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && isAddress(saved)) {
      setPool(saved as Address);
      setPoolInput(saved);
    }
  }, []);

  async function connect() {
    const injected = getInjectedEvmProvider();
    if (!injected) {
      setStatus("Unlock MetaMask, then select it from the Hoodlums wallet chooser.");
      return;
    }
    setBusy(true);
    try {
      const current = (await injected.request({ method: "eth_chainId" })) as string;
      if (Number.parseInt(current, 16) !== ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL) {
        await injected.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: ROBINHOOD_TESTNET.chainId }],
        });
      }
      const accounts = (await injected.request({ method: "eth_requestAccounts" })) as Address[];
      if (!accounts[0]) throw new Error("No wallet account returned.");
      setAccount(accounts[0]);
      setStatus("Wallet connected on Robinhood Testnet.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Wallet connection failed.");
    } finally {
      setBusy(false);
    }
  }

  function savePoolAddress() {
    if (!isAddress(poolInput)) {
      setStatus("Paste the deployed test AMM contract address from the explorer.");
      return;
    }
    const address = poolInput as Address;
    setPool(address);
    localStorage.setItem(STORAGE_KEY, address);
    setStatus("Test AMM address saved. You can now approve and add liquidity.");
  }

  async function approveAndAdd() {
    const injected = getInjectedEvmProvider();
    if (!injected || !account || !pool) {
      setStatus("Connect the wallet and register the test pool first.");
      return;
    }
    setBusy(true);
    try {
      const decimals = await publicClient.readContract({
        address: HOODLUMS,
        abi: ERC20_ABI,
        functionName: "decimals",
      });
      const amount = parseUnits(tokenAmount, decimals);
      const wallet = createWalletClient({ account, chain, transport: custom(injected) });
      const allowance = await publicClient.readContract({
        address: HOODLUMS,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [account, pool],
      });
      if (allowance < amount) {
        setStatus("Approve the test pool to use the selected HOODLUMS amount.");
        const approveHash = await wallet.writeContract({
          address: HOODLUMS,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [pool, amount],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
      }
      setStatus("Confirm the initial HOODLUMS/test-ETH liquidity deposit.");
      const hash = await wallet.writeContract({
        address: pool,
        abi: HOODLUMS_TEST_AMM_ABI,
        functionName: "addLiquidity",
        args: [amount, 0n, 0n, 0n, deadline()],
        value: parseEther(ethAmount),
      });
      await publicClient.waitForTransactionReceipt({ hash });
      setStatus("Liquidity added successfully. This pool is testnet-only and unaudited.");
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Liquidity transaction failed.");
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    if (!pool || !account) return;
    try {
      const [reserveToken, reserveEth, lp, decimals] = await Promise.all([
        publicClient.readContract({ address: pool, abi: HOODLUMS_TEST_AMM_ABI, functionName: "reserveToken" }),
        publicClient.readContract({ address: pool, abi: HOODLUMS_TEST_AMM_ABI, functionName: "reserveEth" }),
        publicClient.readContract({ address: pool, abi: HOODLUMS_TEST_AMM_ABI, functionName: "balanceOf", args: [account] }),
        publicClient.readContract({ address: HOODLUMS, abi: ERC20_ABI, functionName: "decimals" }),
      ]);
      setReserves({
        token: formatUnits(reserveToken, decimals),
        eth: formatEther(reserveEth),
        lp: formatEther(lp),
      });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Pool state could not be read.");
    }
  }

  useEffect(() => {
    void refresh();
  }, [pool, account]);

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <p>ROBINHOOD CHAIN TESTNET · 46630</p>
        <h1>Liquidity Lab</h1>
        <span>
          Deploy a private, test-only constant-product AMM for HOODLUMS. This contract is
          unaudited and must never be used on mainnet.
        </span>
      </section>
      <section className={styles.grid}>
        <article className={styles.card}>
          <h2>1. Connect</h2>
          <button onClick={connect} disabled={busy}>
            {account ? `${account.slice(0, 7)}…${account.slice(-5)}` : "Connect wallet"}
          </button>
        </article>
        <article className={styles.card}>
          <h2>2. Register test AMM</h2>
          <p>
            Deploy <code>contracts/HoodlumsTestLiquidityPool.sol</code> in Remix with the
            HOODLUMS address as its constructor argument, then paste the new contract address.
          </p>
          <input
            aria-label="Test AMM address"
            value={poolInput}
            placeholder="0x…"
            onChange={(event) => setPoolInput(event.target.value.trim())}
          />
          <div className={styles.row}>
            <a href="https://remix.ethereum.org" target="_blank" rel="noreferrer">
              Open Remix ↗
            </a>
            <button onClick={savePoolAddress} disabled={busy}>Save pool address</button>
          </div>
        </article>
        <article className={styles.card}>
          <h2>3. Add initial liquidity</h2>
          <label>
            HOODLUMS
            <input value={tokenAmount} onChange={(event) => setTokenAmount(event.target.value)} />
          </label>
          <label>
            Test ETH
            <input value={ethAmount} onChange={(event) => setEthAmount(event.target.value)} />
          </label>
          <button onClick={approveAndAdd} disabled={busy || !pool || !account}>
            Approve & add liquidity
          </button>
        </article>
        <article className={styles.card}>
          <h2>Pool state</h2>
          <dl>
            <div><dt>HOODLUMS reserve</dt><dd>{reserves.token}</dd></div>
            <div><dt>ETH reserve</dt><dd>{reserves.eth}</dd></div>
            <div><dt>Your LP balance</dt><dd>{reserves.lp}</dd></div>
          </dl>
          <button onClick={refresh} disabled={!pool || !account || busy}>Refresh reserves</button>
        </article>
      </section>
      <p className={styles.status}>{status}</p>
      <a className={styles.back} href="/allocations">← Return to allocations</a>
    </main>
  );
}
