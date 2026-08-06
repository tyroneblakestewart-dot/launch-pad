"use client";

import { useEffect, useRef, useState } from "react";
import {
  formatUsdCents,
  planPaymentDefinition,
  type PaidLaunchPath,
  type PlanPaymentQuote,
  type PlanPaymentVerification,
} from "@/lib/plan-payments";
import styles from "./plan-checkout.module.css";

type EthereumProvider = {
  request: (args: {
    method: string;
    params?: unknown[] | Record<string, unknown>;
  }) => Promise<unknown>;
};

type PaymentWindow = Window & {
  ethereum?: EthereumProvider;
  __launchpadEthereum?: EthereumProvider;
};

type PlanCheckoutProps = {
  plan: PaidLaunchPath;
  onBuilderUnlocked: (plan: PaidLaunchPath) => void;
  onClose: () => void;
};

type CheckoutPhase =
  | "loading"
  | "ready"
  | "sending"
  | "verifying"
  | "success"
  | "error";

const VERIFY_ATTEMPTS = 30;
const VERIFY_DELAY_MS = 2_000;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The wallet payment was cancelled.";
}

async function responseError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === "string" ? body.error : `Request failed (${response.status}).`;
  } catch {
    return `Request failed (${response.status}).`;
  }
}

export function PlanCheckout({ plan, onBuilderUnlocked, onClose }: PlanCheckoutProps) {
  const definition = planPaymentDefinition(plan);
  const [quote, setQuote] = useState<PlanPaymentQuote | null>(null);
  const [phase, setPhase] = useState<CheckoutPhase>("loading");
  const [message, setMessage] = useState("Loading the server-verified payment quote…");
  const [transactionHash, setTransactionHash] = useState("");
  const [verification, setVerification] = useState<PlanPaymentVerification | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();

    fetch(`/api/plan-payments/quote?plan=${encodeURIComponent(plan)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response));
        return (await response.json()) as PlanPaymentQuote;
      })
      .then((nextQuote) => {
        if (!mounted.current) return;
        setQuote(nextQuote);
        setPhase("ready");
        setMessage(
          "Your wallet sends ETH directly to the configured Hoodlums treasury. Access unlocks only after the server verifies the confirmed chain transaction.",
        );
      })
      .catch((error) => {
        if (!mounted.current || controller.signal.aborted) return;
        setPhase("error");
        setMessage(errorMessage(error));
      });

    return () => {
      mounted.current = false;
      controller.abort();
    };
  }, [plan]);

  async function verifyUntilConfirmed(
    walletAddress: string,
    hash: string,
  ): Promise<PlanPaymentVerification> {
    for (let attempt = 0; attempt < VERIFY_ATTEMPTS; attempt += 1) {
      const response = await fetch("/api/plan-payments/verify", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, walletAddress, transactionHash: hash }),
      });

      if (response.ok) return (await response.json()) as PlanPaymentVerification;
      if (response.status !== 202) throw new Error(await responseError(response));
      setMessage("Payment sent. Waiting for Robinhood Chain confirmation…");
      await delay(VERIFY_DELAY_MS);
    }
    throw new Error(
      "The transaction is still pending. Keep the transaction hash and retry verification after it confirms.",
    );
  }

  async function pay() {
    if (!quote || phase === "sending" || phase === "verifying") return;
    setPhase("sending");
    setMessage("Opening your confirmed wallet…");

    try {
      const browserWindow = window as PaymentWindow;
      const provider = browserWindow.__launchpadEthereum || browserWindow.ethereum;
      if (!provider) {
        throw new Error("No EVM wallet was found. Install or unlock MetaMask, Rabby or Phantom.");
      }

      try {
        await provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: quote.chainIdHex }],
        });
      } catch (switchError) {
        const code = (switchError as { code?: number })?.code;
        if (code !== 4902) throw switchError;
        await provider.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: quote.chainIdHex,
              chainName: quote.chainName,
              nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
              rpcUrls: [quote.rpcUrl],
              blockExplorerUrls: [quote.explorerBaseUrl],
            },
          ],
        });
      }

      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
      const walletAddress = accounts?.[0];
      if (!walletAddress) throw new Error("The wallet returned no account.");

      const hash = (await provider.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: walletAddress,
            to: quote.treasuryAddress,
            value: quote.amountWei,
          },
        ],
      })) as string;
      if (!hash) throw new Error("The wallet did not return a transaction hash.");

      setTransactionHash(hash);
      setPhase("verifying");
      setMessage("Payment submitted. Verifying it on the server…");
      const result = await verifyUntilConfirmed(walletAddress, hash);
      if (!mounted.current) return;

      setVerification(result);
      if (result.destination === "builder") {
        setMessage("Payment confirmed. Opening the Pro Site builder…");
        onBuilderUnlocked(plan);
        return;
      }
      setPhase("success");
      setMessage("Subscription confirmed.");
    } catch (error) {
      if (!mounted.current) return;
      setPhase("error");
      setMessage(errorMessage(error));
    }
  }

  if (phase === "success" && verification) {
    return (
      <div className={styles.success} aria-live="polite">
        <span className={styles.successDot} aria-hidden="true">✓</span>
        <span>SUBSCRIPTION ACTIVE</span>
        <h3>You&apos;re subscribed — AI Social Studio coming soon</h3>
        <p>
          {definition.label} is active for this wallet
          {verification.paidUntil
            ? ` until ${new Date(verification.paidUntil).toLocaleDateString()}.`
            : "."}
        </p>
        <code className={styles.receipt}>{verification.transactionHash}</code>
        <button type="button" className={styles.doneButton} onClick={onClose}>
          Done
        </button>
      </div>
    );
  }

  const busy = phase === "loading" || phase === "sending" || phase === "verifying";

  return (
    <div className={styles.shell}>
      <section className={styles.summary}>
        <span>SECURE PLAN PAYMENT</span>
        <h3>{definition.label}</h3>
        <div className={styles.price}>
          <strong>{formatUsdCents(definition.usdCents)}</strong>
          <small>{definition.kind === "subscription" ? "30 days" : "one-off"}</small>
        </div>
        <p>
          {quote
            ? `${quote.amountEth} ETH on ${quote.chainName}`
            : "The exact ETH amount is supplied by the server."}
        </p>
      </section>

      <section className={styles.status} aria-live="polite" aria-busy={busy}>
        <span>{phase === "error" ? "PAYMENT NOT UNLOCKED" : "PAYMENT STATUS"}</span>
        <p className={phase === "error" ? styles.error : undefined}>{message}</p>
        {transactionHash ? <code className={styles.receipt}>{transactionHash}</code> : null}
      </section>

      <div className={styles.actions}>
        <button type="button" className={styles.backButton} onClick={onClose} disabled={busy}>
          Back to plans
        </button>
        <button
          type="button"
          className={`wallet-button ${styles.payButton}`}
          onClick={() => void pay()}
          disabled={!quote || busy}
        >
          {phase === "sending"
            ? "OPENING WALLET…"
            : phase === "verifying"
              ? "VERIFYING…"
              : transactionHash
                ? "RETRY VERIFICATION"
                : "PAY WITH WALLET"}
        </button>
      </div>
    </div>
  );
}
