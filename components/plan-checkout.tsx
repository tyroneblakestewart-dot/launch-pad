"use client";

import { useEffect, useRef, useState } from "react";
import { stringToHex } from "viem";
import { buildPlanPaymentProofMessage } from "@/lib/plan-payment-proof";
import {
  formatUsdCents,
  planPaymentDefinition,
  type PaidLaunchPath,
  type PlanPaymentQuote,
  type PlanPaymentVerification,
} from "@/lib/plan-payments";
import {
  isSubscriptionPlan,
  type SubscriptionBillingPeriod,
} from "@/lib/subscription-lifecycle";
import {
  getInjectedEvmProvider,
  type Eip1193Provider,
} from "@/lib/wallet-provider";
import styles from "./plan-checkout.module.css";

type PlanCheckoutProps = {
  plan: PaidLaunchPath;
  initialBilling?: SubscriptionBillingPeriod;
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

function errorMessage(error: unknown, fallback = "The wallet payment could not continue."): string {
  const providerError = error as { code?: unknown; message?: unknown } | null;
  const code = typeof providerError?.code === "number" ? providerError.code : null;
  if (code === 4001) {
    return `${fallback} You rejected the request in your wallet.`;
  }
  if (code === -32002) {
    return `${fallback} A wallet request is already pending. Open the wallet extension, finish or reject that request, then try again.`;
  }
  if (error instanceof Error && error.message) return `${fallback} ${error.message}`;
  if (typeof providerError?.message === "string" && providerError.message) {
    return `${fallback} ${providerError.message}`;
  }
  return fallback;
}

function normaliseChainId(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return `0x${value.toString(16)}`;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (!/^0x[0-9a-f]+$/.test(trimmed)) return null;
  return trimmed;
}

async function responseError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === "string" ? body.error : `Request failed (${response.status}).`;
  } catch {
    return `Request failed (${response.status}).`;
  }
}

export function PlanCheckout({
  plan,
  initialBilling = "monthly",
  onBuilderUnlocked,
  onClose,
}: PlanCheckoutProps) {
  const definition = planPaymentDefinition(plan);
  const subscription = isSubscriptionPlan(plan);
  const [billingPeriod, setBillingPeriod] = useState<SubscriptionBillingPeriod>(initialBilling);
  const [paymentToken, setPaymentToken] = useState("");
  const [quote, setQuote] = useState<PlanPaymentQuote | null>(null);
  const [phase, setPhase] = useState<CheckoutPhase>("loading");
  const [message, setMessage] = useState("Loading the server-verified payment quote…");
  const [transactionHash, setTransactionHash] = useState("");
  const [paymentWalletAddress, setPaymentWalletAddress] = useState("");
  const [paymentSignature, setPaymentSignature] = useState("");
  const [verification, setVerification] = useState<PlanPaymentVerification | null>(null);
  const mounted = useRef(true);
  const expectedBilling = subscription ? billingPeriod : "one_off";
  const currentQuote =
    quote?.plan === plan &&
    quote.billingPeriod === expectedBilling &&
    (!subscription || !paymentToken || quote.asset === paymentToken)
      ? quote
      : null;
  const busy = phase === "loading" || phase === "sending" || phase === "verifying";
  const selectionLocked = busy || Boolean(transactionHash);
  const needsWalletInteraction = !transactionHash || !paymentSignature;

  function showError(nextMessage: string): void {
    if (!mounted.current) return;
    setPhase("error");
    setMessage(nextMessage);
  }

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    const tokenQuery = subscription && paymentToken
      ? `&token=${encodeURIComponent(paymentToken)}`
      : "";

    fetch(
      `/api/plan-payments/quote?plan=${encodeURIComponent(plan)}&billing=${encodeURIComponent(expectedBilling)}${tokenQuery}`,
      {
        cache: "no-store",
        signal: controller.signal,
      },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response));
        return (await response.json()) as PlanPaymentQuote;
      })
      .then((nextQuote) => {
        if (!mounted.current || controller.signal.aborted) return;
        setQuote(nextQuote);
        if (subscription && paymentToken !== nextQuote.asset) {
          setPaymentToken(nextQuote.asset);
        }
        setPhase("ready");
        setMessage(
          nextQuote.tokenAddress
            ? `Your confirmed wallet sends ${nextQuote.asset} to the configured Hoodlums treasury. Access unlocks only after the server verifies the selected token contract, wallet proof, transfer and confirmed receipt.`
            : "Your confirmed wallet sends ETH to the configured Hoodlums treasury. Access unlocks only after the server verifies the wallet proof and confirmed receipt.",
        );
      })
      .catch((error) => {
        if (!mounted.current || controller.signal.aborted) return;
        showError(errorMessage(error, "The payment quote could not be loaded."));
      });

    return () => {
      mounted.current = false;
      controller.abort();
    };
  }, [expectedBilling, paymentToken, plan, subscription]);

  function resetForSelection(): void {
    setQuote(null);
    setPhase("loading");
    setMessage("Loading the server-verified payment quote…");
    setTransactionHash("");
    setPaymentWalletAddress("");
    setPaymentSignature("");
    setVerification(null);
  }

  function changeBillingPeriod(nextBilling: SubscriptionBillingPeriod): void {
    if (selectionLocked || nextBilling === billingPeriod) return;
    resetForSelection();
    setBillingPeriod(nextBilling);
  }

  function changePaymentToken(nextToken: string): void {
    if (selectionLocked || nextToken === paymentToken) return;
    resetForSelection();
    setPaymentToken(nextToken);
  }

  async function requestWalletProof(
    provider: Eip1193Provider,
    walletAddress: string,
    hash: string,
  ): Promise<string> {
    if (!currentQuote) throw new Error("The payment quote is no longer ready. Reload checkout and retry.");
    setPhase("sending");
    setMessage(
      "Payment submitted. Sign the confirmation message to prove you control the paying wallet. This signature sends no funds.",
    );
    const proofMessage = buildPlanPaymentProofMessage({
      plan,
      billingPeriod: currentQuote.billingPeriod,
      paymentToken: currentQuote.asset,
      walletAddress,
      transactionHash: hash,
      origin: window.location.origin,
    });

    let signature: string;
    try {
      signature = (await provider.request({
        method: "personal_sign",
        params: [stringToHex(proofMessage), walletAddress],
      })) as string;
    } catch (error) {
      throw new Error(errorMessage(error, "The payment was sent, but the wallet signature failed."));
    }
    if (!signature) throw new Error("The wallet did not return a payment proof signature.");
    setPaymentSignature(signature);
    return signature;
  }

  async function verifyUntilConfirmed(
    walletAddress: string,
    hash: string,
    walletSignature: string,
  ): Promise<PlanPaymentVerification> {
    if (!currentQuote) throw new Error("The payment quote is no longer ready. Reload checkout and retry verification.");
    for (let attempt = 0; attempt < VERIFY_ATTEMPTS; attempt += 1) {
      let response: Response;
      try {
        response = await fetch("/api/plan-payments/verify", {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            plan,
            billingPeriod: currentQuote.billingPeriod,
            paymentToken: currentQuote.asset,
            walletAddress,
            transactionHash: hash,
            walletSignature,
          }),
        });
      } catch (error) {
        throw new Error(errorMessage(error, "The payment was sent, but the verification server could not be reached."));
      }

      if (response.ok) return (await response.json()) as PlanPaymentVerification;
      if (response.status !== 202) throw new Error(await responseError(response));
      setMessage("Payment sent. Waiting for Robinhood Chain confirmation…");
      await delay(VERIFY_DELAY_MS);
    }
    throw new Error(
      "The transaction is still pending. Keep the transaction hash and retry verification after it confirms.",
    );
  }

  async function finishVerification(
    walletAddress: string,
    hash: string,
    walletSignature: string,
  ) {
    setPhase("verifying");
    setMessage("Payment submitted. Verifying wallet ownership and the chain transaction…");
    const result = await verifyUntilConfirmed(walletAddress, hash, walletSignature);
    if (!mounted.current) return;

    setVerification(result);
    if (result.destination === "builder") {
      setMessage("Payment confirmed. Opening the Pro Site builder…");
      onBuilderUnlocked(plan);
      return;
    }
    setPhase("success");
    setMessage("Subscription confirmed.");
  }

  async function ensurePaymentChain(
    provider: Eip1193Provider,
    expectedQuote: PlanPaymentQuote,
  ): Promise<void> {
    let currentChain: string | null;
    try {
      currentChain = normaliseChainId(await provider.request({ method: "eth_chainId" }));
    } catch (error) {
      throw new Error(errorMessage(error, "Could not read the wallet network."));
    }
    if (!currentChain) {
      throw new Error("The wallet returned an invalid chain ID. Refresh the wallet connection and try again.");
    }

    const expectedChain = expectedQuote.chainIdHex.toLowerCase();
    if (currentChain !== expectedChain) {
      setMessage(`Switching your wallet to ${expectedQuote.chainName}…`);
      try {
        await provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: expectedQuote.chainIdHex }],
        });
      } catch (switchError) {
        const code = (switchError as { code?: number })?.code;
        if (code !== 4902) {
          throw new Error(
            errorMessage(switchError, `Could not switch the wallet to ${expectedQuote.chainName}.`),
          );
        }
        try {
          await provider.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: expectedQuote.chainIdHex,
                chainName: expectedQuote.chainName,
                nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
                rpcUrls: [expectedQuote.rpcUrl],
                blockExplorerUrls: [expectedQuote.explorerBaseUrl],
              },
            ],
          });
        } catch (addError) {
          throw new Error(
            errorMessage(addError, `Could not add ${expectedQuote.chainName} to the wallet.`),
          );
        }
      }
    }

    let confirmedChain: string | null;
    try {
      confirmedChain = normaliseChainId(await provider.request({ method: "eth_chainId" }));
    } catch (error) {
      throw new Error(errorMessage(error, "Could not confirm the wallet network after switching."));
    }
    if (confirmedChain !== expectedChain) {
      throw new Error(
        `The wallet is still on ${confirmedChain || "an unknown network"}. Switch to ${expectedQuote.chainName} (${expectedQuote.chainId}) and try again.`,
      );
    }
  }

  async function pay() {
    if (!currentQuote) {
      showError("The payment quote is not ready. Wait for the USDG quote to finish loading, then try again.");
      return;
    }
    if (phase === "sending" || phase === "verifying") {
      setMessage("A wallet or verification request is already in progress. Complete it before trying again.");
      return;
    }

    try {
      if (transactionHash && paymentWalletAddress && paymentSignature) {
        await finishVerification(
          paymentWalletAddress,
          transactionHash,
          paymentSignature,
        );
        return;
      }

      const provider = getInjectedEvmProvider();
      if (!provider) {
        throw new Error(
          "No confirmed EVM wallet provider was detected. Re-open Account, confirm MetaMask/Rabby/Phantom, then return to checkout.",
        );
      }

      if (transactionHash && paymentWalletAddress) {
        const signature = await requestWalletProof(
          provider,
          paymentWalletAddress,
          transactionHash,
        );
        await finishVerification(paymentWalletAddress, transactionHash, signature);
        return;
      }

      setPhase("sending");
      setMessage("Checking your confirmed wallet and Robinhood Chain network…");
      await ensurePaymentChain(provider, currentQuote);

      let accounts: string[];
      try {
        accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
      } catch (error) {
        throw new Error(errorMessage(error, "The wallet account request failed."));
      }
      const walletAddress = accounts?.[0];
      if (!walletAddress) {
        throw new Error("The wallet returned no account. Unlock it, confirm the account, and try again.");
      }

      setMessage(
        `Confirm the ${currentQuote.amountDisplay} ${currentQuote.asset} transfer in your wallet. No plan unlocks until it is verified.`,
      );
      let hash: string;
      try {
        hash = (await provider.request({
          method: "eth_sendTransaction",
          params: [
            {
              from: walletAddress,
              to: currentQuote.transactionTo,
              value: currentQuote.transactionValue,
              data: currentQuote.transactionData,
            },
          ],
        })) as string;
      } catch (error) {
        throw new Error(
          errorMessage(error, `${currentQuote.asset} payment was not submitted.`),
        );
      }
      if (!hash) throw new Error("The wallet returned no transaction hash. No payment was recorded.");

      setPaymentWalletAddress(walletAddress);
      setTransactionHash(hash);
      const signature = await requestWalletProof(provider, walletAddress, hash);
      await finishVerification(walletAddress, hash, signature);
    } catch (error) {
      showError(errorMessage(error));
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
          {" "}Paid with {verification.asset}. Renewal is manual and your saved data is retained if the window expires.
        </p>
        <code className={styles.receipt}>{verification.transactionHash}</code>
        {verification.telegramLinkUrl ? (
          <a
            className={styles.telegramButton}
            href={verification.telegramLinkUrl}
            target="_blank"
            rel="noreferrer"
          >
            Link Telegram for renewal reminders
          </a>
        ) : (
          <p className={styles.telegramUnavailable}>
            Telegram linking is not configured on this deployment. In-app reminders remain active.
          </p>
        )}
        <button type="button" className={styles.doneButton} onClick={onClose}>
          Done
        </button>
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      {subscription ? (
        <div className={styles.billingToggle} aria-label="Subscription payment period">
          <button
            type="button"
            className={billingPeriod === "monthly" ? styles.billingActive : styles.billingButton}
            aria-pressed={billingPeriod === "monthly"}
            onClick={() => changeBillingPeriod("monthly")}
            disabled={selectionLocked}
          >
            Monthly · 32 days
          </button>
          <button
            type="button"
            className={billingPeriod === "upfront" ? styles.billingActive : styles.billingButton}
            aria-pressed={billingPeriod === "upfront"}
            onClick={() => changeBillingPeriod("upfront")}
            disabled={selectionLocked}
          >
            3 months upfront · 96 days
          </button>
        </div>
      ) : null}

      {subscription && currentQuote?.paymentTokens.length ? (
        <div className={styles.billingToggle} aria-label="Stablecoin payment token">
          {currentQuote.paymentTokens.map((token) => (
            <button
              key={token.symbol}
              type="button"
              className={paymentToken === token.symbol ? styles.billingActive : styles.billingButton}
              aria-pressed={paymentToken === token.symbol}
              onClick={() => changePaymentToken(token.symbol)}
              disabled={selectionLocked}
              title={token.note || `Pay with ${token.symbol}`}
            >
              Pay with {token.symbol}
            </button>
          ))}
        </div>
      ) : null}

      <section className={styles.summary}>
        <span>SECURE PLAN PAYMENT</span>
        <h3>{definition.label}</h3>
        <div className={styles.price}>
          <strong>{currentQuote ? formatUsdCents(currentQuote.usdCents) : "—"}</strong>
          <small>
            {currentQuote?.billingPeriod === "upfront"
              ? "one manual payment · 20% saving"
              : subscription
                ? "one manual payment · 32 days"
                : "one-off"}
          </small>
        </div>
        <p>
          {currentQuote
            ? `${currentQuote.amountDisplay} ${currentQuote.asset} on ${currentQuote.chainName}`
            : "The exact payment transaction is supplied by the server."}
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
          className={`${needsWalletInteraction ? "wallet-button " : ""}${styles.payButton}`}
          onClick={() => {
            void pay().catch((error) => {
              showError(errorMessage(error, "Payment failed unexpectedly."));
            });
          }}
          disabled={!currentQuote || busy}
        >
          {phase === "sending"
            ? transactionHash
              ? "SIGNING…"
              : "OPENING WALLET…"
            : phase === "verifying"
              ? "VERIFYING…"
              : transactionHash
                ? paymentSignature
                  ? "RETRY VERIFICATION"
                  : "SIGN & VERIFY PAYMENT"
                : currentQuote?.tokenAddress
                  ? `PAY ${currentQuote.asset} WITH WALLET`
                  : "PAY WITH WALLET"}
        </button>
      </div>
    </div>
  );
}
