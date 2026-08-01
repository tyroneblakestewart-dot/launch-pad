"use client";

import { useCallback, useEffect, useState } from "react";
import { createPublicClient, defineChain, formatEther, http, type Address } from "viem";
import { CHAIN_CONFIG, ROBINHOOD_TESTNET, ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL } from "@/lib/chains";
import { getBondingCurveAddress, HOODLUMS_BONDING_CURVE_READ_ABI } from "@/lib/bonding-curve-config";
import {
  computeBondingCurveGraduationStatus,
  formatGraduationProgressPercent,
  type BondingCurveGraduationStatus as GraduationStatus,
} from "@/lib/bonding-curve-status";
import styles from "./bonding-curve-graduation-status.module.css";

const chain = defineChain({
  id: ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL,
  name: ROBINHOOD_TESTNET.chainName,
  nativeCurrency: ROBINHOOD_TESTNET.nativeCurrency,
  rpcUrls: { default: { http: [...ROBINHOOD_TESTNET.rpcUrls] } },
  blockExplorers: {
    default: { name: "Robinhood Testnet Explorer", url: ROBINHOOD_TESTNET.blockExplorerUrls[0] },
  },
  testnet: true,
});

type ViewState =
  | { kind: "no-address" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; status: GraduationStatus };

function shortAddress(value: string): string {
  return value.length > 18 ? `${value.slice(0, 9)}…${value.slice(-7)}` : value;
}

function readError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "shortMessage" in error) {
    return String((error as { shortMessage: unknown }).shortMessage);
  }
  return "Curve state could not be read.";
}

/**
 * Read-only graduation status for a deployed HoodlumsTestBondingCurve: how
 * close it is to its funding target, and whether it has already graduated
 * into a locked liquidity pool. Reads a public RPC endpoint directly, so no
 * wallet connection is required just to view this.
 */
export function BondingCurveGraduationStatus({ curveAddress }: { curveAddress?: Address }) {
  const address = curveAddress ?? getBondingCurveAddress(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL);
  const [view, setView] = useState<ViewState>(address ? { kind: "loading" } : { kind: "no-address" });

  const load = useCallback(async (curve: Address) => {
    setView({ kind: "loading" });
    try {
      const publicClient = createPublicClient({ chain, transport: http(ROBINHOOD_TESTNET.rpcUrls[0]) });
      const [funded, graduated, realNativeReserve, graduationTarget, liquidityPool] = await Promise.all([
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
      setView({
        kind: "ready",
        status: computeBondingCurveGraduationStatus({
          funded,
          graduated,
          realNativeReserveWei: realNativeReserve,
          graduationTargetWei: graduationTarget,
          liquidityPool,
        }),
      });
    } catch (error) {
      setView({ kind: "error", message: readError(error) });
    }
  }, []);

  useEffect(() => {
    if (address) void load(address);
  }, [address, load]);

  if (!address) {
    return (
      <div className={styles.panel} role="status">
        <span className={styles.badgeNeutral}>NOT DEPLOYED</span>
        <p>No bonding curve is configured for Robinhood Chain Testnet yet. Live status appears here once one is.</p>
      </div>
    );
  }

  if (view.kind === "loading") {
    return (
      <div className={styles.panel} role="status">
        <span className={styles.badgeNeutral}>READING…</span>
        <p>Reading live curve state from Robinhood Chain Testnet.</p>
      </div>
    );
  }

  if (view.kind === "error") {
    return (
      <div className={styles.panel} role="status">
        <span className={styles.badgeError}>UNAVAILABLE</span>
        <p>{view.message}</p>
        <button type="button" className={styles.refreshButton} onClick={() => void load(address)}>
          Retry
        </button>
      </div>
    );
  }

  if (view.kind === "no-address") {
    return (
      <div className={styles.panel} role="status">
        <span className={styles.badgeNeutral}>NOT DEPLOYED</span>
        <p>No bonding curve is configured for Robinhood Chain Testnet yet. Live status appears here once one is.</p>
      </div>
    );
  }

  const { status } = view;

  if (status.state === "graduated") {
    const explorerUrl = status.liquidityPool
      ? `${CHAIN_CONFIG.robinhood.explorerBaseUrl}${status.liquidityPool}`
      : null;
    return (
      <div className={styles.panel} role="status">
        <span className={styles.badgeGraduated}>GRADUATED</span>
        <p>The curve reached its graduation target. Its initial liquidity pool is permanently locked.</p>
        <div className={styles.progressTrack}>
          <div className={styles.progressFill} style={{ width: "100%" }} />
        </div>
        {status.liquidityPool ? (
          <div className={styles.poolRow}>
            <span>Locked pool</span>
            <strong>{shortAddress(status.liquidityPool)}</strong>
            {explorerUrl ? (
              <a href={explorerUrl} target="_blank" rel="noreferrer">
                View on explorer ↗
              </a>
            ) : null}
          </div>
        ) : (
          <p>Graduated, but the pool address could not be read.</p>
        )}
      </div>
    );
  }

  if (status.state === "not-funded") {
    return (
      <div className={styles.panel} role="status">
        <span className={styles.badgeNeutral}>NOT YET FUNDED</span>
        <p>The creator hasn&rsquo;t placed the token&rsquo;s full supply into the curve yet. Trading isn&rsquo;t open.</p>
        <button type="button" className={styles.refreshButton} onClick={() => void load(address)}>
          Refresh
        </button>
      </div>
    );
  }

  return (
    <div className={styles.panel} role="status">
      <span className={styles.badgeBonding}>BONDING</span>
      <div className={styles.progressHeader}>
        <span>Graduation progress</span>
        <b>{formatGraduationProgressPercent(status.progressBps)}</b>
      </div>
      <div className={styles.progressTrack}>
        <div
          className={styles.progressFill}
          style={{ width: `${Number(status.progressBps) / 100}%` }}
        />
      </div>
      <p>
        {formatEther(status.raisedWei)} / {formatEther(status.targetWei)} test ETH raised toward graduation.
      </p>
      <button type="button" className={styles.refreshButton} onClick={() => void load(address)}>
        Refresh
      </button>
    </div>
  );
}
