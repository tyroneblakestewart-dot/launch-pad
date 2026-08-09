"use client";

import { useEffect, useRef, useState } from "react";
import { isHash, stringToHex } from "viem";
import { buildPlanPaymentProofMessage } from "@/lib/plan-payment-proof";
import {
  RECOVERABLE_PLAN_PAYMENT_STORAGE_KEY,
  parseRecoverablePlanPayment,
  serialiseRecoverablePlanPayment,
  type RecoverablePlanPayment,
} from "@/lib/plan-payment-recovery";
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

type PaymentPreflight = {
  allowed?: boolean;
  origin?: string;
  recoveryOrigin?: string | null;
  error?: string;
};

const VERIFY_ATTEMPTS = 30;
const VERIFY_DELAY_MS = 2_000;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function errorMessage(
  error: unknown,
  fallback = "The wallet payment could not continue.",
): string {
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
    return typeof body.error === "string"
      ? body.error
      : `Request failed (${response.status}).`;
  } catch {
    return `Request failed (${response.status}).`;
  }
}

async function readPreflight(response: Response): Promise<PaymentPreflight> {
  try {
    return (await response.json()) as PaymentPreflight;
  } catch {
    return {
      allowed: false,
      error: `Payment safety check failed (${response.status}).`,
    };
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
  const [billingPeriod, setBillingPeriod] =
    useState<SubscriptionBillingPeriod>(initialBilling);
  const [paymentToken, setPaymentToken] = useState("");
  const [quote, setQuote] = useState<PlanPaymentQuote | null>(null);
  const [sendOriginAllowed, setSendOriginAllowed] = useState(false);
  const [recoveryOrigin, setRecoveryOrigin] = useState<string | null>(null);
  const [phase, setPhase] = useState<CheckoutPhase>("loading");
  const [message, setMessage] = useState(
    "Loading the server-verified payment quote…",
  );
  const [transactionHash, setTransactionHash] = useState("");
  const [paymentWalletAddress, setPaymentWalletAddress] = useState("");
  const [paymentSignature, setPaymentSignature] = useState("");
  const [verification, setVerification] =
    useState<PlanPaymentVerification | null>(null);
  const [recoveryHash, setRecoveryHash] = useState("");
  const [storedRecovery, setStoredRecovery] =
    useState<RecoverablePlanPayment | null>(null);
  const mounted = useRef(true);

  const expectedBilling = subscription ? billingPeriod : "one_off";
  const currentQuote =
    quote?.plan === plan &&
    quote.billingPeriod === expectedBilling &&
    (!subscription || !paymentToken || quote.asset === paymentToken)
      ? quote
      : null;
  const busy =
    phase === "loading" || phase === "sending" || phase === "verifying";
  const selectionLocked = busy || Boolean(transactionHash);
  const needsWalletInteraction = !transactionHash || !paymentSignature;
  const validRecoveryHash = isHash(recoveryHash.trim());

  function showError(nextMessage: string): void {
    if (!mounted.current) return;
    setPhase("error");
    setMessage(nextMessage);
  }

  function persistRecoverablePayment(
    hash: string,
    walletAddress: string,
    expectedQuote: PlanPaymentQuote,
  ): void {
    const record: RecoverablePlanPayment = {
      version: 1,
      plan,
      billingPeriod: expectedQuote.billingPeriod,
      paymentToken: expectedQuote.asset,
      walletAddress,
      transactionHash: hash,
      amountDisplay: expectedQuote.amountDisplay,
      chainId: expectedQuote.chainId,
      createdAt: new Date().toISOString(),
      origin: window.location.origin,
    };
    localStorage.setItem(
      RECOVERABLE_PLAN_PAYMENT_STORAGE_KEY,
      serialiseRecoverablePlanPayment(record),
    );
    setStoredRecovery(record);
    setRecoveryHash(hash);
  }

  function clearRecoverablePayment(hash: string): void {
    const stored = parseRecoverablePlanPayment(
      localStorage.getItem(RECOVERABLE_PLAN_PAYMENT_STORAGE_KEY),
    );
    if (stored?.transactionHash.toLowerCase() === hash.toLowerCase()) {
      localStorage.removeItem(RECOVERABLE_PLAN_PAYMENT_STORAGE_KEY);
    }
    if (storedRecovery?.transactionHash.toLowerCase() === hash.toLowerCase()) {
      setStoredRecovery(null);
    }
    setRecoveryHash((current) =>
      current.toLowerCase() === hash.toLowerCase() ? "" : current,
    );
  }

  function showPostPaymentError(error: unknown, hash: string): void {
    const details = errorMessage(
      error,
      "The on-chain payment was sent, but activation did not complete.",
    );
    setRecoveryHash(hash);
    showError(
      `${details} Do not pay again. Your transaction is recoverable. Use “Verify existing payment” below with transaction hash ${hash}.`,
    );
  }

  useEffect(() => {
    mounted.current = true;
    const restoreTimer = window.setTimeout(() => {
      const stored = parseRecoverablePlanPayment(
        localStorage.getItem(RECOVERABLE_PLAN_PAYMENT_STORAGE_KEY),
      );
      if (!stored || stored.plan !== plan || !mounted.current) return;
      setStoredRecovery(stored);
      setRecoveryHash(stored.transactionHash);
      if (
        subscription &&
        (stored.billingPeriod === "monthly" || stored.billingPeriod === "upfront")
      ) {
        setBillingPeriod(stored.billingPeriod);
        setPaymentToken(stored.paymentToken);
      }
    }, 0);

    return () => {
      window.clearTimeout(restoreTimer);
      mounted.current = false;
    };
  }, [plan, subscription]);

  useEffect(() => {
    const controller = new AbortController();
    const tokenQuery =
      subscription && paymentToken
        ? `&token=${encodeURIComponent(paymentToken)}`
        : "";

    Promise.all([
      fetch(
        `/api/plan-payments/quote?plan=${encodeURIComponent(plan)}&billing=${encodeURIComponent(expectedBilling)}${tokenQuery}`,
        { cache: "no-store", signal: controller.signal },
      ),
      fetch("/api/plan-payments/preflight", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        signal: controller.signal,
      }),
    ])
      .then(async ([quoteResponse, preflightResponse]) => {
        if (!quoteResponse.ok) {
          throw new Error(await responseError(quoteResponse));
        }
        const nextQuote = (await quoteResponse.json()) as PlanPaymentQuote;
        const preflight = await readPreflight(preflightResponse);
        if (!mounted.current || controller.signal.aborted) return;

        setQuote(nextQuote);
        if (subscription && paymentToken !== nextQuote.asset) {
          setPaymentToken(nextQuote.asset);
        }
        setRecoveryOrigin(preflight.recoveryOrigin || null);

        if (!preflightResponse.ok || !preflight.allowed) {
          setSendOriginAllowed(false);
          setPhase("error");
          setMessage(
            `${preflight.error || "This origin is not approved for sending real payments."} No wallet transaction will be requested here. Existing transaction hashes can still be recovered below without sending money again.`,
          );
          return;
        }

        setSendOriginAllowed(true);
        setPhase("ready");
        setMessage(
          nextQuote.tokenAddress
            ? `Payment safety check passed. Your confirmed wallet can send ${nextQuote.asset} to the configured Hoodlums treasury. Access unlocks only after the server verifies the selected token contract, wallet proof, transfer and confirmed receipt.`
            : "Payment safety check passed. Your confirmed wallet can send ETH to the configured Hoodlums treasury. Access unlocks only after server verification.",
        );
      })
      .catch((error) => {
        if (!mounted.current || controller.signal.aborted) return;
        setSendOriginAllowed(false);
        showError(
          errorMessage(
            error,
            "The payment quote or origin safety check could not be loaded. No wallet transaction will be requested.",
          ),
        );
      });

    return () => controller.abort();
  }, [expectedBilling, paymentToken, plan, subscription]);

  function resetForSelection(): void {
    setQuote(null);
    setSendOriginAllowed(false);
    setPhase("loading");
    setMessage("Checking payment safety and loading the verified quote…");
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

  async function ensureSendOriginAllowed(): Promise<void> {
    let response: Response;
    try {
      response = await fetch("/api/plan-payments/preflight", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
    } catch (error) {
      setSendOriginAllowed(false);
      throw new Error(
        errorMessage(
          error,
          "The payment origin safety check could not be reached. No wallet transaction was requested.",
        ),
      );
    }

    const preflight = await readPreflight(response);
    setRecoveryOrigin(preflight.recoveryOrigin || null);
    if (!response.ok || !preflight.allowed) {
      setSendOriginAllowed(false);
      throw new Error(
        preflight.error ||
          "This origin is not approved for real payments. No wallet transaction was requested.",
      );
    }
    setSendOriginAllowed(true);
  }

  async function requestWalletProof(
    provider: Eip1193Provider,
    walletAddress: string,
    hash: string,
    mode: "payment" | "recovery" = "payment",
  ): Promise<string> {
    if (!currentQuote) {
      throw new Error(
        "The payment quote is no longer ready. Reload checkout and retry.",
      );
    }
    setPhase("sending");
    setMessage(
      mode === "recovery"
        ? "Existing payment found. Sign the recovery proof to confirm you control the paying wallet. This signature sends no funds."
        : "Payment submitted. Sign the confirmation message to prove you control the paying wallet. This signature sends no funds.",
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
      throw new Error(
        errorMessage(
          error,
          mode === "recovery"
            ? "The recovery signature failed."
            : "The payment was sent, but the wallet signature failed.",
        ),
      );
    }
    if (!signature) {
      throw new Error(
        "The wallet did not return a proof signature. The transaction hash remains recoverable.",
      );
    }
    setPaymentSignature(signature);
    return signature;
  }

  async function verifyUntilConfirmed(
    walletAddress: string,
    hash: string,
    walletSignature: string,
  ): Promise<PlanPaymentVerification> {
    if (!currentQuote) {
      throw new Error(
        "The payment quote is no longer ready. Reload checkout and retry verification.",
      );
    }
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
        throw new Error(
          errorMessage(
            error,
            "The payment exists on-chain, but the verification server could not be reached.",
          ),
        );
      }

      if (response.ok) return (await response.json()) as PlanPaymentVerification;
      if (response.status !== 202) throw new Error(await responseError(response));
      setMessage(
        `Transaction ${hash} is saved. Waiting for Robinhood Chain confirmation…`,
      );
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
    setMessage(
      `Verifying existing on-chain transaction ${hash}. No second payment will be sent.`,
    );
    const result = await verifyUntilConfirmed(walletAddress, hash, walletSignature);
    if (!mounted.current) return;

    clearRecoverablePayment(hash);
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
      currentChain = normaliseChainId(
        await provider.request({ method: "eth_chainId" }),
      );
    } catch (error) {
      throw new Error(errorMessage(error, "Could not read the wallet network."));
    }
    if (!currentChain) {
      throw new Error(
        "The wallet returned an invalid chain ID. Refresh the wallet connection and try again.",
      );
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
            errorMessage(
              switchError,
              `Could not switch the wallet to ${expectedQuote.chainName}.`,
            ),
          );
        }
        try {
          await provider.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: expectedQuote.chainIdHex,
                chainName: expectedQuote.chainName,
                nativeCurrency: {
                  name: "Ether",
                  symbol: "ETH",
                  decimals: 18,
                },
                rpcUrls: [expectedQuote.rpcUrl],
                blockExplorerUrls: [expectedQuote.explorerBaseUrl],
              },
            ],
          });
        } catch (addError) {
          throw new Error(
            errorMessage(
              addError,
              `Could not add ${expectedQuote.chainName} to the wallet.`,
            ),
          );
        }
      }
    }

    let confirmedChain: string | null;
    try {
      confirmedChain = normaliseChainId(
        await provider.request({ method: "eth_chainId" }),
      );
    } catch (error) {
      throw new Error(
        errorMessage(
          error,
          "Could not confirm the wallet network after switching.",
        ),
      );
    }
    if (confirmedChain !== expectedChain) {
      throw new Error(
        `The wallet is still on ${confirmedChain || "an unknown network"}. Switch to ${expectedQuote.chainName} (${expectedQuote.chainId}) and try again.`,
      );
    }
  }

  async function currentWallet(provider: Eip1193Provider): Promise<string> {
    let accounts: string[];
    try {
      accounts = (await provider.request({
        method: "eth_requestAccounts",
      })) as string[];
    } catch (error) {
      throw new Error(errorMessage(error, "The wallet account request failed."));
    }
    const walletAddress = accounts?.[0];
    if (!walletAddress) {
      throw new Error(
        "The wallet returned no account. Unlock it, confirm the account, and try again.",
      );
    }
    return walletAddress;
  }

  async function recoverExistingPayment() {
    if (!currentQuote) {
      showError(
        "Load the matching plan, billing period and stablecoin quote before recovering a payment.",
      );
      return;
    }
    const hash = recoveryHash.trim();
    if (!isHash(hash)) {
      showError("Enter a valid 0x-prefixed 32-byte transaction hash to recover.");
      return;
    }
    if (phase === "sending" || phase === "verifying") return;

    const provider = getInjectedEvmProvider();
    if (!provider) {
      showError(
        "No confirmed EVM wallet provider was detected. Re-open Account, confirm the wallet that sent the payment, then retry recovery.",
      );
      return;
    }

    try {
      setPhase("sending");
      setMessage(
        `Recovering transaction ${hash}. This flow will not call eth_sendTransaction.`,
      );
      await ensurePaymentChain(provider, currentQuote);
      const walletAddress = await currentWallet(provider);
      persistRecoverablePayment(hash, walletAddress, currentQuote);
      const signature = await requestWalletProof(
        provider,
        walletAddress,
        hash,
        "recovery",
      );
      await finishVerification(walletAddress, hash, signature);
    } catch (error) {
      showPostPaymentError(error, hash);
    }
  }

  async function pay() {
    if (!currentQuote) {
      showError(
        "The payment quote is not ready. Wait for the USDG quote to finish loading, then try again.",
      );
      return;
    }
    if (!sendOriginAllowed) {
      showError(
        `This origin is not approved for sending a real payment. No wallet transaction will be requested.${recoveryOrigin ? ` Open ${recoveryOrigin} to pay, or recover an existing transaction below.` : ""}`,
      );
      return;
    }
    if (phase === "sending" || phase === "verifying") {
      setMessage(
        "A wallet or verification request is already in progress. Complete it before trying again.",
      );
      return;
    }

    try {
      // Re-run the origin safety check immediately before any wallet request that
      // could move funds. If this fails, eth_sendTransaction is never reached.
      await ensureSendOriginAllowed();

      if (transactionHash && paymentWalletAddress && paymentSignature) {
        try {
          await finishVerification(
            paymentWalletAddress,
            transactionHash,
            paymentSignature,
          );
        } catch (error) {
          showPostPaymentError(error, transactionHash);
        }
        return;
      }

      const provider = getInjectedEvmProvider();
      if (!provider) {
        throw new Error(
          "No confirmed EVM wallet provider was detected. Re-open Account, confirm MetaMask/Rabby/Phantom, then return to checkout.",
        );
      }

      if (transactionHash && paymentWalletAddress) {
        try {
          const signature = await requestWalletProof(
            provider,
            paymentWalletAddress,
            transactionHash,
          );
          await finishVerification(
            paymentWalletAddress,
            transactionHash,
            signature,
          );
        } catch (error) {
          showPostPaymentError(error, transactionHash);
        }
        return;
      }

      setPhase("sending");
      setMessage("Checking your confirmed wallet and Robinhood Chain network…");
      await ensurePaymentChain(provider, currentQuote);
      const walletAddress = await currentWallet(provider);

      setMessage(
        `Confirm the ${currentQuote.amountDisplay} ${currentQuote.asset} transfer in your wallet. The transaction hash will be saved immediately for recovery.`,
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
      if (!hash) {
        throw new Error(
          "The wallet returned no transaction hash. No payment was recorded.",
        );
      }

      // This is deliberately the first action after the wallet returns a hash.
      // From this point onward every failure can be recovered without paying again.
      setPaymentWalletAddress(walletAddress);
      setTransactionHash(hash);
      persistRecoverablePayment(hash, walletAddress, currentQuote);

      try {
        const signature = await requestWalletProof(provider, walletAddress, hash);
        await finishVerification(walletAddress, hash, signature);
      } catch (error) {
        showPostPaymentError(error, hash);
      }
    } catch (error) {
      showError(errorMessage(error));
    }
  }

  if (phase === "success" && verification) {
    return (
      <div className={styles.success} aria-live="polite">
        <span className={styles.successDot} aria-hidden="true">✓</span>
        <span>SUBSCRIPTION ACTIVE</span>
        <h3>You&apos;re subscribed — AI Social Studio unlocked</h3>
        <p>
          {definition.label} is active for this wallet
          {verification.paidUntil
            ? ` until ${new Date(verification.paidUntil).toLocaleDateString()}.`
            : "."}{" "}
          Paid with {verification.asset}. Renewal is manual and your saved data is
          retained if the window expires.
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
            Telegram linking is not configured on this deployment. In-app reminders
            remain active.
          </p>
        )}
        <button
          type="button"
          className={styles.doneButton}
          onClick={() => window.location.assign("/social")}
        >
          Open AI Social Studio
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
            className={
              billingPeriod === "monthly"
                ? styles.billingActive
                : styles.billingButton
            }
            aria-pressed={billingPeriod === "monthly"}
            onClick={() => changeBillingPeriod("monthly")}
            disabled={selectionLocked}
          >
            Monthly · 32 days
          </button>
          <button
            type="button"
            className={
              billingPeriod === "upfront"
                ? styles.billingActive
                : styles.billingButton
            }
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
              className={
                paymentToken === token.symbol
                  ? styles.billingActive
                  : styles.billingButton
              }
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
          <strong>
            {currentQuote ? formatUsdCents(currentQuote.usdCents) : "—"}
          </strong>
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
        <span>
          {phase === "error" ? "PAYMENT NOT UNLOCKED" : "PAYMENT STATUS"}
        </span>
        <p className={phase === "error" ? styles.error : undefined}>{message}</p>
        {transactionHash ? (
          <code className={styles.receipt}>{transactionHash}</code>
        ) : null}
      </section>

      <section className={styles.recovery} aria-label="Recover an existing payment">
        <span>ALREADY PAID?</span>
        <h4>Recover an existing payment</h4>
        <p>
          Paste the transaction hash from the original payment and select the same
          plan, billing period and stablecoin. Your wallet signs a fresh proof for
          this origin; this recovery flow never sends a second transfer.
        </p>
        {storedRecovery ? (
          <p className={styles.recoverySaved}>
            Saved locally: {storedRecovery.amountDisplay} {storedRecovery.paymentToken}
            {" · "}{storedRecovery.transactionHash}
          </p>
        ) : null}
        <input
          className={styles.recoveryInput}
          type="text"
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="0x… transaction hash"
          value={recoveryHash}
          onChange={(event) => setRecoveryHash(event.target.value.trim())}
          disabled={busy}
          aria-label="Existing payment transaction hash"
        />
        <button
          type="button"
          className={`wallet-button ${styles.recoverButton}`}
          onClick={() => {
            void recoverExistingPayment().catch((error) => {
              showPostPaymentError(error, recoveryHash.trim());
            });
          }}
          disabled={!currentQuote || busy || !validRecoveryHash}
        >
          VERIFY EXISTING PAYMENT — NO NEW TRANSFER
        </button>
        {!sendOriginAllowed && recoveryOrigin ? (
          <a className={styles.recoveryLink} href={recoveryOrigin}>
            Open approved payment origin: {recoveryOrigin}
          </a>
        ) : null}
      </section>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.backButton}
          onClick={onClose}
          disabled={busy}
        >
          Back to plans
        </button>
        <button
          type="button"
          className={`${needsWalletInteraction ? "wallet-button " : ""}${styles.payButton}`}
          onClick={() => {
            void pay().catch((error) => {
              if (transactionHash) {
                showPostPaymentError(error, transactionHash);
              } else {
                showError(errorMessage(error, "Payment failed unexpectedly."));
              }
            });
          }}
          disabled={!currentQuote || busy || !sendOriginAllowed}
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
