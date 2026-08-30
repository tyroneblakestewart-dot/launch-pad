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
import type { BondingCurveGraduationStatus } from "@/lib/bonding-curve-status";
import { CHAIN_CONFIG, ROBINHOOD_TESTNET, ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL } from "@/lib/chains";
import { notifyTokenTradeConfirmed } from "@/lib/token-trade-events";
import { getInjectedEvmProvider } from "@/lib/wallet-provider";
import { formatFeeNote, formatNativeAmountSixSigFigsTrimmed, formatTokenBalanceAmount, shortenAddress } from "@/lib/token-page-format";
import type { TokenTrade } from "@/lib/token-trade-types";
import type { TokenCurveStatus } from "@/lib/use-token-curve-status";
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
      /** remainingNativeToGraduate() as of the shared curve status's last read — 0n once graduated. */
      remainingToGraduateWei: bigint;
      graduation: BondingCurveGraduationStatus;
    };

/**
 * Derives this panel's local `CurveView` shape from the page-level shared
 * `TokenCurveStatus` (issue #444) plus this panel's own resolved decimals —
 * the two types otherwise carry the same fields, since
 * `lib/use-token-curve-status.ts` is a superset read covering both this
 * swap panel and the header band.
 */
function toCurveView(curveStatus: TokenCurveStatus, decimals: number): CurveView {
  if (curveStatus.kind !== "ready") return curveStatus;
  return {
    kind: "ready",
    curve: curveStatus.curve,
    decimals,
    creator: curveStatus.creator,
    remainingToGraduateWei: curveStatus.remainingToGraduateWei,
    graduation: curveStatus.graduation,
  };
}

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
  tradeLinks: TradeTerminalLink[];
  /** Whether a token_launches row exists for this token — drives the Stats/Audit panel's verified vs unverified treatment (issue #443 part 1). */
  factoryMinted: boolean;
  /** The page-level shared curve-status poll (issue #444) — also fed to the header band, so both panels always agree. */
  curveStatus: TokenCurveStatus;
  /** The page-level shared trades poll (issue #444), forwarded straight through to the Stats/Audit panel. */
  trades: TokenTrade[] | null;
};

/**
 * Renders the buy/sell swap panel, the Stats/Audit panel and the
 * creator-fee panel (issue #443 part 1 supersedes issue #429's identity
 * card here — identity, graduation and price now live in the header band,
 * `components/token-page/token-header-band.tsx`). All three panels are
 * wrapped in `.leftGroup`, invisible to layout at every width
 * (`display: contents`), letting the chart panel interleave between the
 * swap and stats panels on mobile per the "header → swap → chart → stats →
 * tabs" order. At the desktop breakpoint the swap panel becomes its own
 * grid item (row 1, alongside the chart panel), while the Stats/Audit panel
 * and the creator-fee panel are wrapped together in `.leftRest`, a flex
 * column that is itself the row-2 grid item — sized to its own content
 * rather than stretched or stuck in place (issue #450: the design doesn't
 * use sticky positioning here, and it can't survive being split across two
 * grid rows). `curveStatus` is the page-level
 * shared on-chain curve read (issue #444, lib/use-token-curve-status.ts) —
 * previously this component ran its own independent `loadCurve` poll
 * against the same curve the header band was also independently polling;
 * both now read the one shared result, derived into this panel's own
 * `CurveView` shape by `toCurveView`. That shared status is itself resolved
 * by the server (lib/server/token-launch-curve-lookup.ts, issue #412
 * Part 2) from the specific launch that deployed this token, falling back
 * to the legacy single-curve-per-chain env var; this component still
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
  tradeLinks,
  factoryMinted,
  curveStatus,
  trades,
}: TokenLeftColumnProps) {
  const chainInfo = CHAIN_CONFIG[chainId];
  const displaySymbol = marketStats.supported && marketStats.symbol ? marketStats.symbol : null;
  const resolvedDecimals = marketStats.supported && marketStats.decimals !== null ? marketStats.decimals : DEFAULT_TOKEN_DECIMALS;

  const curveView = toCurveView(curveStatus, resolvedDecimals);
  const [side, setSide] = useState<Side>("buy");
  const [amount, setAmount] = useState("");
  // Tracks which preset button (0.1/0.5/1/MAX on buy, 25%/50%/75%/MAX on
  // sell) produced the current amount, so that button alone gets the
  // selected recipe (issue #460 RULES) — cleared the moment the user edits
  // the amount by hand or switches side, since neither still reflects that
  // preset's value.
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
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
    [setClaimableFeeWei],
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

  // A past trade's "Trade confirmed." hint is only meaningful for the trade
  // it was reported for — once the user changes the side or the amount
  // (typing, a preset, or a new quote it triggers), it stops describing
  // what's on screen and must clear (issue #451 item 5). `submitTrade`
  // itself still sets `amount` directly (not through this helper) after a
  // genuine success, so the just-shown confirmation survives that reset.
  // A preset's own selected state only describes an amount that came from a
  // preset tap — any direct edit or a side switch means the field no longer
  // reflects a specific preset's value, so both clear it.
  function updateAmount(next: string) {
    setAmount(next);
    setStatusMessage("");
    setSelectedPreset(null);
  }

  function changeSide(next: Side) {
    setSide(next);
    setStatusMessage("");
    setSelectedPreset(null);
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
      setStatusMessage("");
      setSelectedPreset(preset);
      return;
    }
    if (tokenBalance === null || curveView.kind !== "ready") return;
    const percent = preset === "MAX" ? 100 : Number(preset.replace("%", ""));
    const portion = (tokenBalance * BigInt(percent)) / 100n;
    setAmount(formatUnits(portion, curveView.decimals));
    setStatusMessage("");
    setSelectedPreset(preset);
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

      // Every confirmed trade — success or revert — spent gas, so the
      // balance refetch always runs; only a genuine success clears the
      // input and reports it as such (issue #427: a reverted transaction
      // previously fell through to "Trade confirmed." unchallenged, since
      // waitForTransactionReceipt() only throws on an RPC/timeout failure,
      // never on a mined-but-reverted receipt). A reverted trade never
      // moved the curve's own reserves, so only a genuine success needs to
      // refresh curve state — it does so by firing
      // TOKEN_TRADE_CONFIRMED_EVENT (issue #444), the same event the page's
      // shared curve-status and trades polls both already listen for, so
      // this component no longer refetches the curve directly.
      void refreshBalances(account);
      if (isCreator) void refreshClaimableFee(account, curveView.curve);

      if (receipt.status === "reverted") {
        setStatusMessage("");
        setTradeError(describeRevertedTrade(hash));
      } else {
        setStatusMessage("Trade confirmed.");
        notifyTokenTradeConfirmed({ curveAddress: curveView.curve });
        setAmount("");
        setReceiveRaw(null);
        setSellFeeRaw(null);
        setSelectedPreset(null);
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
      {/* Swap, Stats/Audit and creator-fee panels share the left side of
          the page (issue #443 part 1) — `.leftGroup` is `display: contents`
          at every width so these panels stay direct grid siblings of the
          chart panel, which interleaves between swap and stats per the
          mobile order; at desktop widths the swap panel becomes its own
          grid item and the Stats/Audit + creator-fee panels are grouped
          into `.leftRest` below (`token-page.module.css`, issue #450). */}
      <div className={styles.leftGroup}>
        {curveView.kind === "ready" && curveView.graduation.state !== "graduated" ? (
          <div className={`${styles.panel} ${styles.swapPanel}`}>
            <div className={styles.swapTopRow}>
              <div className={styles.tabGroup}>
                <button
                  type="button"
                  className={`${styles.pillButton} ${styles.buySellTab} ${side === "buy" ? styles.pillButtonActive : ""}`}
                  onClick={() => changeSide("buy")}
                >
                  Buy
                </button>
                <button
                  type="button"
                  className={`${styles.pillButton} ${styles.buySellTab} ${side === "sell" ? styles.pillButtonActive : ""}`}
                  onClick={() => changeSide("sell")}
                >
                  Sell
                </button>
              </div>
              <button
                type="button"
                className={`${styles.walletButton} ${account ? styles.walletButtonConnected : ""}`}
                onClick={connectWallet}
              >
                {account ? (
                  <>
                    <span className={styles.walletDot} />
                    {shortenAddress(account)}
                  </>
                ) : (
                  "Connect wallet"
                )}
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
                      ? `${formatTokenBalanceAmount(Number(formatUnits(tokenBalance, curveView.decimals)))} ${payTicker}`
                      : "—"}
                </span>
              </div>
              <div className={styles.amountRow}>
                <input
                  className={styles.amountInput}
                  value={amount}
                  onChange={(event) => updateAmount(event.target.value.replace(/[^0-9.]/g, ""))}
                  inputMode="decimal"
                  placeholder="0.0"
                />
                <span className={styles.tickerPill}>{payTicker}</span>
              </div>
              <div className={styles.presetRow}>
                {(side === "buy" ? BUY_PRESETS : SELL_PRESETS).map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className={`${styles.presetButton} ${selectedPreset === preset ? styles.presetButtonSelected : ""}`}
                    onClick={() => applyPreset(preset)}
                  >
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

        {/* Grouped together (issue #450) so they occupy a single grid cell
            at the desktop breakpoint (`.leftRest`, `token-page.module.css`)
            — `display: contents` on mobile keeps them direct grid-item
            siblings of the mobile stack, unchanged from before. */}
        <div className={styles.leftRest}>
          <TokenStatsAuditPanel
            trades={trades}
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
                  {claimableFeeWei !== null
                    ? `${formatNativeAmountSixSigFigsTrimmed(Number(formatEther(claimableFeeWei)))} ETH`
                    : "—"}
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
      </div>
    </>
  );
}
