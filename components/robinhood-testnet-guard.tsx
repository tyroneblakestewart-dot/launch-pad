"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ROBINHOOD_TESTNET,
  ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL,
  ROBINHOOD_TESTNET_CHAIN_ID_HEX,
} from "@/lib/chains";
import styles from "./robinhood-testnet-guard.module.css";

type Eip1193Provider = {
  request: (args: {
    method: string;
    params?: unknown[] | Record<string, unknown>;
  }) => Promise<unknown>;
  on?: (event: string, listener: (value: unknown) => void) => void;
  removeListener?: (event: string, listener: (value: unknown) => void) => void;
};

type BrowserWindow = Window & {
  ethereum?: Eip1193Provider;
  __launchpadEthereum?: Eip1193Provider;
};

const TARGET_CHAIN_ID = ROBINHOOD_TESTNET_CHAIN_ID_HEX.toLowerCase();
const BYPASS_ATTRIBUTE = "data-testnet-guard-bypass";

function getProvider(): Eip1193Provider | null {
  const browserWindow = window as BrowserWindow;
  return browserWindow.__launchpadEthereum || browserWindow.ethereum || null;
}

function normaliseChainId(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "";

  if (trimmed.startsWith("0x")) {
    const numeric = Number.parseInt(trimmed.slice(2), 16);
    return Number.isFinite(numeric) ? `0x${numeric.toString(16)}` : "";
  }

  const numeric = Number.parseInt(trimmed, 10);
  return Number.isFinite(numeric) ? `0x${numeric.toString(16)}` : "";
}

function decimalChainId(chainId: string): string {
  if (!chainId) return "unknown";
  const numeric = Number.parseInt(chainId.replace(/^0x/, ""), 16);
  return Number.isFinite(numeric) ? String(numeric) : "unknown";
}

export function RobinhoodTestnetGuard() {
  const [chainId, setChainId] = useState("");
  const [message, setMessage] = useState("Connect an EVM wallet to verify the network.");
  const [isSwitching, setIsSwitching] = useState(false);

  const refreshChain = useCallback(async () => {
    const provider = getProvider();
    if (!provider) {
      setChainId("");
      setMessage("Connect an EVM wallet to verify the network.");
      return "";
    }

    try {
      const nextChainId = normaliseChainId(
        await provider.request({ method: "eth_chainId" }),
      );
      setChainId(nextChainId);
      setMessage(
        nextChainId === TARGET_CHAIN_ID
          ? "Correct testnet detected. Mainnet remains blocked."
          : `Wrong network detected: chain ${decimalChainId(nextChainId)}.`,
      );
      return nextChainId;
    } catch {
      setMessage("Unlock the selected wallet so its network can be checked.");
      return "";
    }
  }, []);

  useEffect(() => {
    let attachedProvider: Eip1193Provider | null = null;

    function handleChainChanged(value: unknown) {
      const nextChainId = normaliseChainId(value);
      setChainId(nextChainId);
      setMessage(
        nextChainId === TARGET_CHAIN_ID
          ? "Correct testnet detected. Mainnet remains blocked."
          : `Wrong network detected: chain ${decimalChainId(nextChainId)}.`,
      );
    }

    function attachProviderListener() {
      const provider = getProvider();
      if (provider === attachedProvider) return;
      if (attachedProvider?.removeListener) {
        attachedProvider.removeListener("chainChanged", handleChainChanged);
      }
      attachedProvider = provider;
      attachedProvider?.on?.("chainChanged", handleChainChanged);
    }

    async function guardPrepareLaunch(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest("button") as HTMLButtonElement | null;
      if (!button || button.disabled) return;
      if (!button.textContent?.trim().toLowerCase().includes("prepare launch")) return;

      const activeChain = document
        .querySelector("button.chain-option.active")
        ?.textContent?.toLowerCase();
      if (activeChain?.includes("solana")) return;

      if (button.hasAttribute(BYPASS_ATTRIBUTE)) {
        button.removeAttribute(BYPASS_ATTRIBUTE);
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const liveChainId = await refreshChain();
      if (liveChainId !== TARGET_CHAIN_ID) {
        setMessage(
          `Prepare launch blocked. Switch MetaMask to Robinhood Chain Testnet (${ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL}).`,
        );
        return;
      }

      window.setTimeout(() => {
        button.setAttribute(BYPASS_ATTRIBUTE, "true");
        button.click();
      }, 0);
    }

    attachProviderListener();
    void refreshChain();

    const timer = window.setInterval(() => {
      attachProviderListener();
      void refreshChain();
    }, 2000);

    window.addEventListener("focus", refreshChain);
    document.addEventListener("click", guardPrepareLaunch, true);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshChain);
      document.removeEventListener("click", guardPrepareLaunch, true);
      attachedProvider?.removeListener?.("chainChanged", handleChainChanged);
    };
  }, [refreshChain]);

  async function switchToTestnet() {
    const provider = getProvider();
    if (!provider || isSwitching) {
      setMessage("Connect and unlock the selected EVM wallet first.");
      return;
    }

    setIsSwitching(true);
    try {
      try {
        await provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: ROBINHOOD_TESTNET.chainId }],
        });
      } catch (error) {
        const code = (error as { code?: number })?.code;
        if (code !== 4902) throw error;
        await provider.request({
          method: "wallet_addEthereumChain",
          params: [ROBINHOOD_TESTNET],
        });
      }
      await refreshChain();
    } catch (error) {
      const reason = error instanceof Error ? error.message : "The wallet rejected the network switch.";
      setMessage(reason);
    } finally {
      setIsSwitching(false);
    }
  }

  const correctNetwork = chainId === TARGET_CHAIN_ID;

  return (
    <aside
      className={correctNetwork ? styles.guardReady : styles.guard}
      aria-live="polite"
    >
      <div className={styles.heading}>
        <span className={styles.dot} />
        <div>
          <small>SAFE-MODE NETWORK</small>
          <b>Robinhood Chain Testnet</b>
        </div>
      </div>
      <code>CHAIN ID {ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL} · {TARGET_CHAIN_ID}</code>
      <p>{message}</p>
      {!correctNetwork && (
        <button type="button" onClick={switchToTestnet} disabled={isSwitching}>
          {isSwitching ? "SWITCHING…" : "SWITCH TO TESTNET"}
        </button>
      )}
    </aside>
  );
}
