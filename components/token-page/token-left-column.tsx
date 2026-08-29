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
  HOODLUMS_BONDING_CURVE_FEES_ABI,
  HOODLUMS_BONDING_CURVE_READ_ABI,
  HOODLUMS_BONDING_CURVE_TRADE_ABI,
} from "@/lib/bonding-curve-config";
import { DEFAULT_TOKEN_DECIMALS } from "@/lib/bonding-curve-deploy-config";
import {
  CREATOR_FEE_SHARE_BPS,
  PROTOCOL_FEE_SHARE_BPS,
  TRADING_FEE_BPS,
  buyNetFromGross,
  grossNativeInForExactNet,
  tradingFee,
} from "@/lib/bonding-curve-fee-math";
import { applySlippageFloor } from "@/lib/bonding-curve-slippage";
import { computeBondingCurveGraduationStatus } from "@/lib/bonding-curve-status";
import { CHAIN_CONFIG, ROBINHOOD_TESTNET, ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL } from "@/lib/chains";
import { notifyTokenTradeConfirmed } from "@/lib/token-trade-events";
import { getInjectedEvmProvider } from "@/lib/wallet-provider";
import { formatFeeNote, shortenAddress } from "@/lib/token-page-format";
import { TokenStatsAuditPanel } from "./token-stats-audit-panel";
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
      creator: Address;
      /** remainingNativeToGraduate() at load time — 0n once graduated. */
      remainingToGraduateWei: bigint;
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

// Trade UX correctness fix (issue #427): a thrown error (wallet rejection,
// RPC failure, disconnect) never reached the chain, so nothing was sent.
function describeTradeSubmissionFailure(error: unknown): string {
  return `${readError(error)} Nothing was sent — you can try again.`;
}

// viem's waitForTransactionReceipt() resolves normally even for a reverted
// transaction (it only throws on a genuine RPC/timeout failure), so a plain
// try/catch around it silently reported "Trade confirmed." for a trade that
// actually failed on-chain. Every receipt's own `status` must be checked.
function describeRevertedTrade(hash: `0x${string}`): string {
  return `Transaction reverted on-chain (${shortenAddress(hash)}) — no funds were moved. Try again with a smaller amount or more slippage.`;
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
  /** Whether a token_launches row exists for this token — drives the Stats/Audit panel's verified vs unverified treatment (issue #443 part 1). */
  factoryMinted: boolean;
};

/**
 * Renders the buy/sell swap panel, the Stats/Audit panel and the
 * creator-fee panel (issue #443 part 1 supersedes issue #429's identity
 * card here — identity, graduation and price now live in the header band,
 * `components/token-page/token-header-band.tsx`). All three panels are
 * wrapped in `.leftGroup`, which is invisible to layout on mobile
 * (`display: contents`, letting the chart panel interleave between the
 * swap and stats panels per the new "header → swap → chart → stats → tabs"
 * mobile order) and becomes the actual sticky flex column at desktop
 * widths, in swap → stats → fees order. `curveAddress` is
 * resolved by the server (lib/server/token-launch-curve-lookup.ts, issue
 * #412 Part 2) from the specific launch that deployed this token, falling
 * back to the legacy single-curve-per-chain env var; this component still
 * confirms on-chain that the resolved curve's own `token()` matches this
 * page's address before showing live swap controls. Once the curve reports
 * graduated, the swap form is replaced by an honest "trading closed"
 * panel — the contract itself blocks buy()/sell() post-graduation — and a
 * creator fee panel appears whenever the connected wallet is confirmed
 * on-chain as the curve's creator (fees remain withdrawable either way).
 * Both the swap and fee-withdraw flows check the transaction receipt's own
 * `status` (issue #427) — a reverted-but-mined transaction is not the same
 * as a successful one, and viem's `waitForTransactionReceipt()` does not
 * throw for a reverted receipt on its own.
 * Anything else (wrong/no curve, non-EVM chain) falls back to the
 * referral-coded "Trade on terminal" links instead of a dead swap form.
 */
export function TokenLeftColumn({
  chainId,
  address,
  marketStats,
  curveAddress,
  tradeLinks,
  factoryMinted,
}: TokenLeftColumnProps) {
  const chainInfo = CHAIN_CONFIG[chainId];
  const displaySymbol = marketStats.supported && marketStats.symbol ? marketStats.symbol : null;
  const resolvedDecimals = marketStats.supported && marketStats.decimals !== null ? marketStats.decimals : DEFAULT_TOKEN_DECIMALS;

  const [curveView, setCurveView] = useState<CurveView>(curveAddress ? { kind: "loading" } : { kind: "no-address" });
  const [side, setSide] = useState<Side>("buy");
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState<number>(100);
  const [account, setAccount] = useState<Address | null>(null);
  const [nativeBalance, setNativeBalance] = useState<bigint | null>(null);
  const [tokenBalance, setTokenBalance] = useState<bigint | null>(null);
  const [receiveRaw, setReceiveRaw] = useState<bigint | null>(null);
  const [sellFeeRaw, setSellFeeRaw] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [tradeError, setTradeError] = useState("");
  const [claimableFeeWei, setClaimableFeeWei] = useState<bigint | null>(null);
  const [feeBusy, setFeeBusy] = useState(false);
  const [feeStatusMessage, setFeeStatusMessage] = useState("");
  const [feeError, setFeeError] = useState("");

  const loadCurve = useCallback(async (curve: Address) => {
    setCurveView({ kind: "loading" });
    try {
      const publicClient = createPublicClient({ chain, transport: http(ROBINHOOD_TESTNET.rpcUrls[0]) });
      const [tokenAddress, funded, graduated, realNativeReserve, graduationTarget, liquidityPool, remainingToGraduate, creator] =
        await Promise.all([
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
          publicClient.readContract({
            address: curve,
            abi: HOODLUMS_BONDING_CURVE_TRADE_ABI,
            functionName: "remainingNativeToGraduate",
          }),
          publicClient.readContract({ address: curve, abi: HOODLUMS_BONDING_CURVE_FEES_ABI, functionName: "creator" }),
        ]);

      if ((tokenAddress as string).toLowerCase() !== address.toLowerCase()) {
        setCurveView({ kind: "wrong-token" });
        return;
      }

      setCurveView({
        kind: "ready",
        curve,
        decimals: marketStats.supported && marketStats.decimals !== null ? marketStats.decimals : DEFAULT_TOKEN_DECIMALS,
        creator,
        remainingToGraduateWei: remainingToGraduate,
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

  // Live graduation progress/stats (issue #430 requirement 4): other
  // wallets' trades don't otherwise reach this page without a manual
  // refresh, so this re-reads the curve every 12s while the tab is visible,
  // following lib/use-token-trades.ts's same visible-tab-only pattern —
  // paused on a hidden tab, refetched immediately on focus/visibilitychange.
  // The connected wallet's own trade already refetches directly inside
  // submitTrade() below; this timer covers everyone else's trades too.
  useEffect(() => {
    if (!curveAddress) return;
    const resolvedCurveAddress = curveAddress;
    let timer: number | null = null;

    function isPageVisible(): boolean {
      try {
        return document.visibilityState === "visible";
      } catch {
        return true;
      }
    }

    function startTimer() {
      if (timer !== null) return;
      timer = window.setInterval(() => void loadCurve(resolvedCurveAddress), 12_000);
    }

    function stopTimer() {
      if (timer === null) return;
      window.clearInterval(timer);
      timer = null;
    }

    function handleBecameVisible() {
      if (!isPageVisible()) {
        stopTimer();
        return;
      }
      void loadCurve(resolvedCurveAddress);
      startTimer();
    }

    if (isPageVisible()) startTimer();
    document.addEventListener("visibilitychange", handleBecameVisible);
    window.addEventListener("focus", handleBecameVisible);

    return () => {
      stopTimer();
      document.removeEventListener("visibilitychange", handleBecameVisible);
      window.removeEventListener("focus", handleBecameVisible);
    };
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

  // Creator fee panel data (issue #412 Part 2): only meaningful once the
  // curve is loaded and the connected wallet is confirmed on-chain as its
  // creator — claimableFees() itself already returns 0 for anyone else, but
  // checking here avoids showing the panel to every visitor.
  const isCreator =
    curveView.kind === "ready" && account !== null && account.toLowerCase() === curveView.creator.toLowerCase();

  const refreshClaimableFee = useCallback(
    async (wallet: Address, curve: Address) => {
      try {
        const publicClient = createPublicClient({ chain, transport: http(ROBINHOOD_TESTNET.rpcUrls[0]) });
        const amount = await publicClient.readContract({
          address: curve,
          abi: HOODLUMS_BONDING_CURVE_FEES_ABI,
          functionName: "claimableFees",
          args: [wallet],
        });
        setClaimableFeeWei(amount);
      } catch {
        // Leaves the last-known claimable amount in place; not fatal.
      }
    },
    [],
  );

  useEffect(() => {
    if (isCreator && account && curveView.kind === "ready") {
      void refreshClaimableFee(account, curveView.curve);
    } else {
      setClaimableFeeWei(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCreator, account, curveView.kind === "ready" ? curveView.curve : null]);

  async function withdrawCreatorFees() {
    if (curveView.kind !== "ready" || !account) return;
    setFeeBusy(true);
    setFeeStatusMessage("");
    setFeeError("");
    try {
      const provider = getInjectedEvmProvider();
      if (!provider) throw new Error("EVM wallet disconnected.");
      const walletClient = createWalletClient({ chain, transport: custom(provider) });
      const publicClient = createPublicClient({ chain, transport: http(ROBINHOOD_TESTNET.rpcUrls[0]) });
      const hash = await walletClient.writeContract({
        account,
        address: curveView.curve,
        abi: HOODLUMS_BONDING_CURVE_FEES_ABI,
        functionName: "withdrawFees",
      });
      setFeeStatusMessage(`Transaction submitted: ${shortenAddress(hash)}`);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status === "reverted") {
        setFeeStatusMessage("");
        setFeeError(describeRevertedTrade(hash));
      } else {
        setFeeStatusMessage("Fees withdrawn.");
      }
      void refreshClaimableFee(account, curveView.curve);
      void refreshBalances(account);
    } catch (error) {
      setFeeStatusMessage("");
      setFeeError(describeTradeSubmissionFailure(error));
    } finally {
      setFeeBusy(false);
    }
  }

  // Debounced live quote as the amount changes, mirroring the design's
  // "You receive" preview. Silently clears on an unparsable/zero amount or a
  // failed on-chain read instead of showing a stale or misleading figure.
  useEffect(() => {
    if (curveView.kind !== "ready") return;
    const readyCurve = curveView;
    const amountNumber = Number(amount);
    if (!amount || !Number.isFinite(amountNumber) || amountNumber <= 0) {
      setReceiveRaw(null);
      setSellFeeRaw(null);
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
          setSellFeeRaw(null);
        } else {
          const tokensIn = parseUnits(amount, readyCurve.decimals);
          const [nativeOut, sellFee] = await Promise.all([
            publicClient.readContract({
              address: readyCurve.curve,
              abi: HOODLUMS_BONDING_CURVE_TRADE_ABI,
              functionName: "quoteSell",
              args: [tokensIn],
            }),
            publicClient.readContract({
              address: readyCurve.curve,
              abi: HOODLUMS_BONDING_CURVE_TRADE_ABI,
              functionName: "quoteSellFee",
              args: [tokensIn],
            }),
          ]);
          setReceiveRaw(nativeOut);
          setSellFeeRaw(sellFee);
        }
      } catch {
        setReceiveRaw(null);
        setSellFeeRaw(null);
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
        // Cap MAX at the exact gross input that nets to exactly
        // remainingToGraduateWei when that's the binding constraint, so the
        // curve's buy() call can never revert with BuyExceedsGraduationTarget
        // (issue #412 Part 2's graduation clamp) — the contract only allows a
        // buy whose net-of-fee input is <= what's left to reach the target.
        const balanceCap = nativeBalance ?? 0n;
        const graduationCap =
          curveView.kind === "ready" && curveView.remainingToGraduateWei > 0n
            ? grossNativeInForExactNet(curveView.remainingToGraduateWei)
            : null;
        const cap = graduationCap !== null && graduationCap < balanceCap ? graduationCap : balanceCap;
        setAmount(nativeBalance !== null ? formatEther(cap) : "");
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

    if (side === "buy") {
      let grossWei: bigint;
      try {
        grossWei = parseEther(amount);
      } catch {
        return;
      }
      const netIn = buyNetFromGross(grossWei);
      if (netIn > curveView.remainingToGraduateWei) {
        setTradeError(
          `That buy would exceed the ${formatEther(curveView.remainingToGraduateWei)} ETH remaining to graduation. Use MAX to buy exactly up to the target.`,
        );
        return;
      }
    }

    setBusy(true);
    setStatusMessage("");
    setTradeError("");
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
      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      // Every confirmed trade — success or revert — spent gas and can move
      // balances, so the curve/balance refetch always runs; only a genuine
      // success clears the input and reports it as such (issue #427: a
      // reverted transaction previously fell through to "Trade confirmed."
      // unchallenged, since waitForTransactionReceipt() only throws on an
      // RPC/timeout failure, never on a mined-but-reverted receipt).
      void refreshBalances(account);
      if (isCreator) void refreshClaimableFee(account, curveView.curve);
      if (curveAddress) void loadCurve(curveAddress);

      if (receipt.status === "reverted") {
        setStatusMessage("");
        setTradeError(describeRevertedTrade(hash));
      } else {
        setStatusMessage("Trade confirmed.");
        notifyTokenTradeConfirmed({ curveAddress: curveView.curve });
        setAmount("");
        setReceiveRaw(null);
        setSellFeeRaw(null);
      }
    } catch (error) {
      setStatusMessage("");
      setTradeError(describeTradeSubmissionFailure(error));
    } finally {
      setBusy(false);
    }
  }

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

  // Honest fee breakdown shown before every signature (issue #412 Part 2):
  // a buy's 1% fee is a pure function of its gross input, computed with the
  // same mirror used elsewhere (lib/bonding-curve-fee-math.ts); a sell's fee
  // depends on the curve's current reserves, so it comes from the
  // quoteSellFee() read fetched alongside the quote above.
  const buyFeeWei = (() => {
    if (side !== "buy" || !amount) return null;
    try {
      return tradingFee(parseEther(amount));
    } catch {
      return null;
    }
  })();
  const feeWei = curveView.kind === "ready" && amount && receiveRaw !== null ? (side === "buy" ? buyFeeWei : sellFeeRaw) : null;

  return (
    <>
      {/* Swap, Stats/Audit and creator-fee panels move and stick together
          as one desktop column (issue #443 part 1) — `.leftGroup` is
          `display: contents` on mobile so these panels stay direct grid
          siblings of the chart panel, which interleaves between swap and
          stats per the new mobile order, and becomes the real sticky flex
          column at desktop widths (`token-page.module.css`). */}
      <div className={styles.leftGroup}>
        {curveView.kind === "ready" && curveView.graduation.state !== "graduated" ? (
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

            {feeWei !== null && (
              <div className={styles.feeBreakdown}>
                <div className={styles.feeBreakdownRow}>
                  <span>Trading fee (1%)</span>
                  <b>{formatEther(feeWei)} ETH</b>
                </div>
              </div>
            )}

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
            {tradeError ? (
              <p className={styles.tradeErrorText} role="alert">
                {tradeError}
              </p>
            ) : statusMessage ? (
              <p className={styles.tradeHint}>{statusMessage}</p>
            ) : null}
            <p className={styles.feeNote}>{formatFeeNote(TRADING_FEE_BPS, PROTOCOL_FEE_SHARE_BPS, CREATOR_FEE_SHARE_BPS, false)}</p>
          </div>
        ) : curveView.kind === "ready" && curveView.graduation.state === "graduated" ? (
          <div className={`${styles.panel} ${styles.swapPanel}`}>
            <div className={styles.terminalFallback}>
              <span className={styles.sectionLabel}>Trading closed</span>
              <p className={styles.terminalFallbackCopy}>
                This token graduated — its full curve balance moved into a permanently locked Robinhood DEX pool, and
                buy/sell on the bonding curve is closed for good. Accrued trading fees remain withdrawable by the
                treasury and creator.
              </p>
              {curveView.graduation.liquidityPool && (
                <a
                  href={`${chainInfo.explorerBaseUrl}${curveView.graduation.liquidityPool}`}
                  target="_blank"
                  rel="noreferrer"
                  className={styles.terminalFallbackLink}
                >
                  View liquidity pool ↗
                </a>
              )}
              <p className={styles.feeNote}>{formatFeeNote(TRADING_FEE_BPS, PROTOCOL_FEE_SHARE_BPS, CREATOR_FEE_SHARE_BPS, true)}</p>
            </div>
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

        <TokenStatsAuditPanel
          curveAddress={curveAddress}
          decimals={resolvedDecimals}
          holderCount={marketStats.supported ? marketStats.holderCount : null}
          factoryMinted={factoryMinted}
        />

        {isCreator && curveView.kind === "ready" && (
          <div className={`${styles.panel} ${styles.feePanel}`}>
            <span className={styles.sectionLabel}>Creator fees</span>
            <div className={styles.feePanelRow}>
              <span className={styles.mutedNote}>Claimable balance</span>
              <span className={styles.feeClaimValue}>
                {claimableFeeWei !== null ? `${formatEther(claimableFeeWei)} ETH` : "—"}
              </span>
            </div>
            <button
              type="button"
              className={styles.feeWithdrawButton}
              onClick={withdrawCreatorFees}
              disabled={feeBusy || claimableFeeWei === null || claimableFeeWei === 0n}
            >
              {feeBusy ? "Withdrawing…" : "Withdraw fees"}
            </button>
            {feeError ? (
              <p className={styles.tradeErrorText} role="alert">
                {feeError}
              </p>
            ) : feeStatusMessage ? (
              <p className={styles.tradeHint}>{feeStatusMessage}</p>
            ) : null}
          </div>
        )}
      </div>
    </>
  );
}
