"use client";

import { useCallback, useEffect, useState } from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  formatEther,
  formatUnits,
  http,
  parseEther,
  parseUnits,
  type Address,
} from "viem";
import {
  ERC20_MIN_ABI,
  HOODLUMS_BONDING_CURVE_READ_ABI,
  HOODLUMS_BONDING_CURVE_TRADE_ABI,
} from "@/lib/bonding-curve-config";
import { DEFAULT_TOKEN_DECIMALS } from "@/lib/bonding-curve-deploy-config";
import { applySlippageFloor } from "@/lib/bonding-curve-slippage";
import {
  computeBondingCurveGraduationStatus,
  formatGraduationProgressPercent,
} from "@/lib/bonding-curve-status";
import { CHAIN_CONFIG, ROBINHOOD_TESTNET, ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL } from "@/lib/chains";
import { getInjectedEvmProvider } from "@/lib/wallet-provider";
import { formatCompactUsd, formatHolderCount, formatUsdPrice, shortenAddress } from "@/lib/token-page-format";
import type { TradeTerminalLink } from "@/lib/trade-terminal-links";
import type { TokenMarketStats } from "@/lib/server/token-market-stats";
import type { SupportedChain } from "@/lib/types";
import styles from "./token-page.module.css";

const chain = defineChain({
  id: ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL,
  name: ROBINHOOD_TESTNET.chainName,
  nativeCurrency: ROBINHOOD_TESTNET.nativeCurrency,
  rpcUrls: { default: { http: [...ROBINHOOD_TESTNET.rpcUrls] } },
  blockExplorers: { default: { name: "Robinhood Chain Explorer", url: ROBINHOOD_TESTNET.blockExplorerUrls[0] } },
  testnet: true,
});

const BUY_PRESETS = ["0.1", "0.5", "1", "MAX"] as const;
const SELL_PRESETS = ["25%", "50%", "75%", "MAX"] as const;
const SLIPPAGE_OPTIONS_BPS = [50, 100, 300] as const;
const TRADE_DEADLINE_SECONDS = 600;

type CurveView =
  | { kind: "no-address" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "wrong-token" }
  | {
      kind: "ready";
      curve: Address;
      decimals: number;
      graduation: ReturnType<typeof computeBondingCurveGraduationStatus>;
    };

type Side = "buy" | "sell";

function readError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "shortMessage" in error) {
    return String((error as { shortMessage: unknown }).shortMessage);
  }
  return "The transaction failed.";
}

function formatSlippageLabel(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`;
}

type TokenLeftColumnProps = {
  chainId: SupportedChain;
  address: string;
  marketStats: TokenMarketStats;
  curveAddress: Address | null;
  tradeLinks: TradeTerminalLink[];
};

/**
 * Left column of the public token page (issue #225): token identity, market
 * stats, live graduation progress, and the buy/sell swap panel — plus the
 * mobile sticky swap bar, which shares this component's wallet/curve state
 * instead of duplicating a second on-chain read. All on-chain state is read
 * from a single configured bonding curve (`lib/bonding-curve-config.ts`);
 * trading only activates once that curve's own `token()` matches this page's
 * address, since one env var currently configures a single curve per chain.
 * Anything else (wrong/no curve, non-EVM chain) falls back to the
 * referral-coded "Trade on terminal" links instead of a dead swap form.
 */
export function TokenLeftColumn({ chainId, address, marketStats, curveAddress, tradeLinks }: TokenLeftColumnProps) {
  const chainInfo = CHAIN_CONFIG[chainId];
  const displayName = (marketStats.supported && marketStats.name) || shortenAddress(address);
  const displaySymbol = marketStats.supported && marketStats.symbol ? marketStats.symbol : null;

  const [copied, setCopied] = useState(false);
  const [curveView, setCurveView] = useState<CurveView>(curveAddress ? { kind: "loading" } : { kind: "no-address" });
  const [side, setSide] = useState<Side>("buy");
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState<number>(100);
  const [account, setAccount] = useState<Address | null>(null);
  const [nativeBalance, setNativeBalance] = useState<bigint | null>(null);
  const [tokenBalance, setTokenBalance] = useState<bigint | null>(null);
  const [receiveRaw, setReceiveRaw] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  const loadCurve = useCallback(async (curve: Address) => {
    setCurveView({ kind: "loading" });
    try {
      const publicClient = createPublicClient({ chain, transport: http(ROBINHOOD_TESTNET.rpcUrls[0]) });
      const [tokenAddress, funded, graduated, realNativeReserve, graduationTarget, liquidityPool] = await Promise.all([
        publicClient.readContract({ address: curve, abi: HOODLUMS_BONDING_CURVE_TRADE_ABI, functionName: "token" }),
        publicClient.readContract({ address: curve, abi: HOODLUMS_BONDING_CURVE_READ_ABI, functionName: "funded" }),
        publicClient.readContract({ address: curve, abi: HOODLUMS_BONDING_CURVE_READ_ABI, functionName: "graduated" }),
        publicClient.readContract({
          address: curve,
          abi: HOODLUMS_BONDING_CURVE_READ_ABI,
          functionName: "realNativeReserve",
        }),
        publicClient.readContract({
          address: curve,
          abi: HOODLUMS_BONDING_CURVE_READ_ABI,
          functionName: "graduationTarget",
        }),
        publicClient.readContract({
          address: curve,
          abi: HOODLUMS_BONDING_CURVE_READ_ABI,
          functionName: "liquidityPool",
        }),
      ]);

      if ((tokenAddress as string).toLowerCase() !== address.toLowerCase()) {
        setCurveView({ kind: "wrong-token" });
        return;
      }

      setCurveView({
        kind: "ready",
        curve,
        decimals: marketStats.supported && marketStats.decimals !== null ? marketStats.decimals : DEFAULT_TOKEN_DECIMALS,
        graduation: computeBondingCurveGraduationStatus({
          funded,
          graduated,
          realNativeReserveWei: realNativeReserve,
          graduationTargetWei: graduationTarget,
          liquidityPool,
        }),
      });
    } catch (error) {
      setCurveView({ kind: "error", message: readError(error) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  useEffect(() => {
    if (curveAddress) void loadCurve(curveAddress);
  }, [curveAddress, loadCurve]);

  const curveReady = curveView.kind === "ready";

  const refreshBalances = useCallback(
    async (wallet: Address) => {
      if (!curveReady) return;
      try {
        const publicClient = createPublicClient({ chain, transport: http(ROBINHOOD_TESTNET.rpcUrls[0]) });
        const [native, token] = await Promise.all([
          publicClient.getBalance({ address: wallet }),
          publicClient.readContract({
            address: address as Address,
            abi: ERC20_MIN_ABI,
            functionName: "balanceOf",
            args: [wallet],
          }),
        ]);
        setNativeBalance(native);
        setTokenBalance(token);
      } catch {
        // Balances stay at their last-known value; not fatal to trading.
      }
    },
    [address, curveReady],
  );

  useEffect(() => {
    if (account) void refreshBalances(account);
  }, [account, refreshBalances]);

  // Debounced live quote as the amount changes, mirroring the design's
  // "You receive" preview. Silently clears on an unparsable/zero amount or a
  // failed on-chain read instead of showing a stale or misleading figure.
  useEffect(() => {
    if (curveView.kind !== "ready") return;
    const readyCurve = curveView;
    const amountNumber = Number(amount);
    if (!amount || !Number.isFinite(amountNumber) || amountNumber <= 0) {
      setReceiveRaw(null);
      return;
    }

    const handle = setTimeout(async () => {
      try {
        const publicClient = createPublicClient({ chain, transport: http(ROBINHOOD_TESTNET.rpcUrls[0]) });
        if (side === "buy") {
          const grossWei = parseEther(amount);
          const tokensOut = await publicClient.readContract({
            address: readyCurve.curve,
            abi: HOODLUMS_BONDING_CURVE_TRADE_ABI,
            functionName: "quoteBuy",
            args: [grossWei],
          });
          setReceiveRaw(tokensOut);
        } else {
          const tokensIn = parseUnits(amount, readyCurve.decimals);
          const nativeOut = await publicClient.readContract({
            address: readyCurve.curve,
            abi: HOODLUMS_BONDING_CURVE_TRADE_ABI,
            functionName: "quoteSell",
            args: [tokensIn],
          });
          setReceiveRaw(nativeOut);
        }
      } catch {
        setReceiveRaw(null);
      }
    }, 350);

    return () => clearTimeout(handle);
  }, [amount, side, curveView]);

  async function connectWallet() {
    setStatusMessage("");
    try {
      const provider = getInjectedEvmProvider();
      if (!provider) throw new Error("Install MetaMask or another EVM wallet first.");
      try {
        await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ROBINHOOD_TESTNET.chainId }] });
      } catch (switchError) {
        if ((switchError as { code?: number })?.code !== 4902) throw switchError;
        await provider.request({ method: "wallet_addEthereumChain", params: [ROBINHOOD_TESTNET] });
      }
      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
      if (!accounts[0]) throw new Error("No EVM account was returned.");
      setAccount(accounts[0] as Address);
    } catch (error) {
      setStatusMessage(readError(error));
    }
  }

  function applyPreset(preset: string) {
    if (side === "buy") {
      if (preset === "MAX") {
        setAmount(nativeBalance !== null ? formatEther(nativeBalance) : "");
      } else {
        setAmount(preset);
      }
      return;
    }
    if (tokenBalance === null || curveView.kind !== "ready") return;
    const percent = preset === "MAX" ? 100 : Number(preset.replace("%", ""));
    const portion = (tokenBalance * BigInt(percent)) / 100n;
    setAmount(formatUnits(portion, curveView.decimals));
  }

  async function submitTrade() {
    if (curveView.kind !== "ready" || !account || receiveRaw === null) return;
    setBusy(true);
    setStatusMessage("");
    try {
      const provider = getInjectedEvmProvider();
      if (!provider) throw new Error("EVM wallet disconnected.");
      const walletClient = createWalletClient({ chain, transport: custom(provider) });
      const publicClient = createPublicClient({ chain, transport: http(ROBINHOOD_TESTNET.rpcUrls[0]) });
      const deadline = BigInt(Math.floor(Date.now() / 1000) + TRADE_DEADLINE_SECONDS);
      const minOut = applySlippageFloor(receiveRaw, slippageBps);

      let hash: `0x${string}`;
      if (side === "buy") {
        const grossWei = parseEther(amount);
        hash = await walletClient.writeContract({
          account,
          address: curveView.curve,
          abi: HOODLUMS_BONDING_CURVE_TRADE_ABI,
          functionName: "buy",
          args: [minOut, deadline],
          value: grossWei,
        });
      } else {
        const tokensIn = parseUnits(amount, curveView.decimals);
        const allowance = await publicClient.readContract({
          address: address as Address,
          abi: ERC20_MIN_ABI,
          functionName: "allowance",
          args: [account, curveView.curve],
        });
        if (allowance < tokensIn) {
          const approveHash = await walletClient.writeContract({
            account,
            address: address as Address,
            abi: ERC20_MIN_ABI,
            functionName: "approve",
            args: [curveView.curve, tokensIn],
          });
          await publicClient.waitForTransactionReceipt({ hash: approveHash });
        }
        hash = await walletClient.writeContract({
          account,
          address: curveView.curve,
          abi: HOODLUMS_BONDING_CURVE_TRADE_ABI,
          functionName: "sell",
          args: [tokensIn, minOut, deadline],
        });
      }

      setStatusMessage(`Transaction submitted: ${shortenAddress(hash)}`);
      await publicClient.waitForTransactionReceipt({ hash });
      setStatusMessage("Trade confirmed.");
      setAmount("");
      setReceiveRaw(null);
      void refreshBalances(account);
      if (curveAddress) void loadCurve(curveAddress);
    } catch (error) {
      setStatusMessage(readError(error));
    } finally {
      setBusy(false);
    }
  }

  const graduationSection = (() => {
    if (curveView.kind === "ready") {
      const { graduation } = curveView;
      const widthPercent = Number(graduation.progressBps) / 100;
      return (
        <div className={styles.graduation}>
          <div className={styles.graduationHeader}>
            <span className={styles.graduationLabel}>Graduation</span>
            <span className={styles.graduationValue}>
              {formatEther(graduation.raisedWei)} / {formatEther(graduation.targetWei)} ETH
            </span>
          </div>
          <div className={styles.track}>
            <div className={styles.fill} style={{ width: `${widthPercent}%` }} />
          </div>
          <div className={styles.graduationFooter}>
            <span>{formatGraduationProgressPercent(graduation.progressBps)} to Robinhood DEX</span>
            <span>{graduation.state === "graduated" ? "graduated" : "bonding"}</span>
          </div>
        </div>
      );
    }
    if (curveView.kind === "loading") {
      return <p className={styles.mutedNote}>Reading live curve state…</p>;
    }
    if (curveView.kind === "error") {
      return <p className={styles.mutedNote}>Curve state unavailable: {curveView.message}</p>;
    }
    return <p className={styles.mutedNote}>No bonding curve is configured for this token yet.</p>;
  })();

  const payTicker = side === "buy" ? "ETH" : displaySymbol || "TOKEN";
  const receiveTicker = side === "buy" ? displaySymbol || "TOKEN" : "ETH";
  const receiveDisplay =
    receiveRaw === null
      ? "0"
      : side === "buy" && curveView.kind === "ready"
        ? formatUnits(receiveRaw, curveView.decimals)
        : formatEther(receiveRaw);

  const tradeDisabled = !curveReady || !account || !amount || receiveRaw === null || busy;
  const tradeLabel = !account ? `Connect wallet to ${side}` : busy ? "Submitting…" : side === "buy" ? "Buy" : "Sell";

  return (
    <>
      <div className={styles.panel}>
        <div className={styles.artwork}>Drop token art</div>

        <div className={styles.identityHeader}>
          <div className={styles.identityTopRow}>
            <span className={styles.identityName}>{displayName}</span>
            <span className={styles.chainBadge}>{chainInfo.shortLabel}</span>
          </div>
          <button
            type="button"
            className={styles.copyButton}
            onClick={() => {
              if (typeof navigator !== "undefined" && navigator.clipboard) {
                void navigator.clipboard.writeText(address);
              }
              setCopied(true);
              setTimeout(() => setCopied(false), 1400);
            }}
          >
            <span>{shortenAddress(address)}</span>
            <span className={styles.copyButtonLabel}>{copied ? "copied" : "copy"}</span>
          </button>
        </div>

        <div className={styles.statsGrid}>
          <div className={styles.statCell}>
            <span className={styles.statLabel}>Market cap</span>
            <span className={styles.statValue}>
              {formatCompactUsd(marketStats.supported ? marketStats.marketCapUsd : null)}
            </span>
          </div>
          <div className={styles.statCell}>
            <span className={styles.statLabel}>Liquidity</span>
            <span className={styles.statValue}>
              {formatCompactUsd(marketStats.supported ? marketStats.liquidityUsd : null)}
            </span>
          </div>
          <div className={styles.statCell}>
            <span className={styles.statLabel}>24h volume</span>
            <span className={styles.statValue}>
              {formatCompactUsd(marketStats.supported ? marketStats.volume24hUsd : null)}
            </span>
          </div>
          <div className={styles.statCell}>
            <span className={styles.statLabel}>Holders</span>
            <span className={styles.statValue}>
              {formatHolderCount(marketStats.supported ? marketStats.holderCount : null)}
            </span>
          </div>
        </div>

        {graduationSection}
      </div>

      {curveView.kind === "ready" ? (
        <div className={`${styles.panel} ${styles.swapPanel}`}>
          <div className={styles.swapTopRow}>
            <div className={styles.tabGroup}>
              <button
                type="button"
                className={`${styles.pillButton} ${styles.buySellTab} ${side === "buy" ? styles.pillButtonActive : ""}`}
                onClick={() => setSide("buy")}
              >
                Buy
              </button>
              <button
                type="button"
                className={`${styles.pillButton} ${styles.buySellTab} ${side === "sell" ? styles.pillButtonActive : ""}`}
                onClick={() => setSide("sell")}
              >
                Sell
              </button>
            </div>
            <button
              type="button"
              className={`${styles.walletButton} ${account ? styles.walletButtonConnected : ""}`}
              onClick={connectWallet}
            >
              {account ? shortenAddress(account) : "Connect wallet"}
            </button>
          </div>

          <div className={styles.fieldBox}>
            <div className={styles.fieldHeaderRow}>
              <span className={styles.fieldLabel}>{side === "buy" ? "You pay" : "You sell"}</span>
              <span className={styles.fieldBalance}>
                bal{" "}
                {side === "buy"
                  ? nativeBalance !== null
                    ? `${formatEther(nativeBalance)} ETH`
                    : "—"
                  : tokenBalance !== null
                    ? `${formatUnits(tokenBalance, curveView.decimals)} ${payTicker}`
                    : "—"}
              </span>
            </div>
            <div className={styles.amountRow}>
              <input
                className={styles.amountInput}
                value={amount}
                onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ""))}
                inputMode="decimal"
                placeholder="0.0"
              />
              <span className={styles.tickerPill}>{payTicker}</span>
            </div>
            <div className={styles.presetRow}>
              {(side === "buy" ? BUY_PRESETS : SELL_PRESETS).map((preset) => (
                <button key={preset} type="button" className={styles.presetButton} onClick={() => applyPreset(preset)}>
                  {preset}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.swapDivider}>
            <span className={styles.swapDividerIcon}>↓</span>
          </div>

          <div className={styles.fieldBox}>
            <span className={styles.fieldLabel}>You receive</span>
            <div className={styles.amountRow}>
              <span className={styles.amountValue}>{receiveDisplay}</span>
              <span className={`${styles.tickerPill} ${styles.tickerPillAccent}`}>{receiveTicker}</span>
            </div>
          </div>

          <div className={styles.slippageRow}>
            <span className={styles.slippageLabel}>Slippage</span>
            <div className={styles.slippageGroup}>
              {SLIPPAGE_OPTIONS_BPS.map((bps) => (
                <button
                  key={bps}
                  type="button"
                  className={`${styles.pillButton} ${styles.slippageButton} ${slippageBps === bps ? styles.pillButtonActive : ""}`}
                  onClick={() => setSlippageBps(bps)}
                >
                  {formatSlippageLabel(bps)}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            className={`${styles.tradeButton} ${side === "buy" ? styles.tradeButtonBuy : styles.tradeButtonSell}`}
            disabled={account ? tradeDisabled : false}
            onClick={account ? submitTrade : connectWallet}
          >
            {tradeLabel}
          </button>
          {statusMessage ? <p className={styles.tradeHint}>{statusMessage}</p> : null}
        </div>
      ) : (
        <div className={`${styles.panel} ${styles.swapPanel}`}>
          <div className={styles.terminalFallback}>
            <span className={styles.sectionLabel}>Trade {displaySymbol || "this token"}</span>
            <p className={styles.terminalFallbackCopy}>
              {curveView.kind === "loading"
                ? "Checking whether a bonding curve is live for this token…"
                : tradeLinks.length > 0
                  ? "No bonding curve is active for this token yet. Trade it on a terminal instead."
                  : "No bonding curve is active for this token yet."}
            </p>
            {tradeLinks.length > 0 && (
              <div className={styles.terminalFallbackLinks}>
                {tradeLinks.map((link) => (
                  <a key={link.id} href={link.url} target="_blank" rel="noreferrer" className={styles.terminalFallbackLink}>
                    {link.label}
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div className={styles.mobileBar}>
        <div className={styles.mobileBarInfo}>
          <span className={styles.mobileBarTicker}>{displaySymbol || "TOKEN"}</span>
          <span className={styles.mobileBarPrice}>
            {formatUsdPrice(marketStats.supported ? marketStats.priceUsd : null)}
          </span>
        </div>
        {curveView.kind === "ready" ? (
          <>
            <button type="button" className={styles.mobileBuyButton} onClick={account ? submitTrade : connectWallet}>
              Buy
            </button>
            <button type="button" className={styles.mobileSellButton} onClick={() => setSide("sell")}>
              Sell
            </button>
          </>
        ) : tradeLinks[0] ? (
          <a
            href={tradeLinks[0].url}
            target="_blank"
            rel="noreferrer"
            className={`${styles.mobileBuyButton} ${styles.mobileTradeLink}`}
          >
            Trade
          </a>
        ) : null}
      </div>
    </>
  );
}
