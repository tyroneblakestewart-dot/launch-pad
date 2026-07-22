"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createPublicClient, createWalletClient, custom, defineChain, type Address } from "viem";
import { ROBINHOOD_TESTNET, ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL } from "@/lib/chains";
import { getInjectedEvmProvider } from "@/lib/wallet-provider";
import {
  HOODLUMS_TOKEN_FACTORY_ABI,
  HOODLUMS_TOKEN_FACTORY_ARTIFACT_READY,
  HOODLUMS_TOKEN_FACTORY_BYTECODE,
} from "@/lib/hoodlums-token-factory-artifact";
import {
  APPROVED_FACTORY_FEE_RECIPIENT_ADDRESS,
  APPROVED_FACTORY_OWNER_ADDRESS,
  FACTORY_DEPLOYMENT_CHAIN_ID_HEX,
  FACTORY_DEPLOYMENT_EXPLORER_BASE_URL,
  buildFactoryConstructorArgs,
  buildFactoryDeploymentRecord,
  isApprovedFactoryChain,
  isApprovedFactoryOwner,
  normaliseChainIdHex,
  parseFactoryDeploymentResult,
  verifyDeployedFactory,
  type FactoryDeploymentRecord,
  type FactoryVerificationResult,
} from "@/lib/hoodlums-token-factory-deployment";
import styles from "./hoodlums-factory-setup.module.css";

const robinhoodTestnet = defineChain({
  id: ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL,
  name: ROBINHOOD_TESTNET.chainName,
  nativeCurrency: ROBINHOOD_TESTNET.nativeCurrency,
  rpcUrls: { default: { http: [...ROBINHOOD_TESTNET.rpcUrls] } },
  blockExplorers: {
    default: { name: "Robinhood Chain Testnet Explorer", url: FACTORY_DEPLOYMENT_EXPLORER_BASE_URL },
  },
  testnet: true,
});

type DeploymentState = {
  factoryAddress: Address;
  transactionHash: string;
  verification: FactoryVerificationResult;
  record: FactoryDeploymentRecord;
};

function readError(error: unknown): string {
  if (typeof error === "object" && error && "shortMessage" in error) {
    return String((error as { shortMessage: unknown }).shortMessage);
  }
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "The factory deployment failed.";
}

function shortAddress(value: string): string {
  return value.length > 18 ? `${value.slice(0, 9)}…${value.slice(-7)}` : value;
}

export function HoodlumsFactorySetup() {
  const [account, setAccount] = useState<Address | null>(null);
  const [chainIdHex, setChainIdHex] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(
    "Connect the approved owner wallet on Robinhood Chain Testnet to begin.",
  );
  const [deployment, setDeployment] = useState<DeploymentState | null>(null);

  useEffect(() => {
    const provider = getInjectedEvmProvider();
    if (!provider) return;
    provider
      .request({ method: "eth_chainId" })
      .then((value) => setChainIdHex(normaliseChainIdHex(String(value))))
      .catch(() => {
        // The connect button re-reads the chain id; a stale read here is not fatal.
      });
  }, []);

  const chainOk = isApprovedFactoryChain(chainIdHex);
  const ownerOk = isApprovedFactoryOwner(account);
  const canDeploy =
    HOODLUMS_TOKEN_FACTORY_ARTIFACT_READY && chainOk && ownerOk && confirmed && !busy && !deployment;

  async function switchToTestnet(provider: NonNullable<ReturnType<typeof getInjectedEvmProvider>>) {
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: ROBINHOOD_TESTNET.chainId }],
      });
    } catch (switchError) {
      if ((switchError as { code?: number })?.code !== 4902) throw switchError;
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [ROBINHOOD_TESTNET],
      });
    }
  }

  async function connectWallet() {
    const provider = getInjectedEvmProvider();
    if (!provider) {
      setStatus("Install or select an EVM wallet first.");
      return;
    }

    setBusy(true);
    try {
      const currentChain = normaliseChainIdHex(
        String(await provider.request({ method: "eth_chainId" })),
      );
      if (currentChain !== FACTORY_DEPLOYMENT_CHAIN_ID_HEX) {
        await switchToTestnet(provider);
      }

      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
      if (!accounts[0]) throw new Error("No EVM account was returned.");
      setAccount(accounts[0] as Address);

      const liveChain = normaliseChainIdHex(
        String(await provider.request({ method: "eth_chainId" })),
      );
      setChainIdHex(liveChain);
      setStatus(
        isApprovedFactoryOwner(accounts[0])
          ? "Approved owner wallet connected on the correct network."
          : `Connected wallet ${shortAddress(accounts[0])} does not match the approved factory owner address.`,
      );
    } catch (error) {
      setStatus(readError(error));
    } finally {
      setBusy(false);
    }
  }

  async function deploy() {
    if (!HOODLUMS_TOKEN_FACTORY_ARTIFACT_READY) {
      setStatus(
        "Factory bytecode artifact has not been generated yet. Run `npm run contracts:compile` " +
          "then `npm run contracts:factory-artifact` locally, commit the regenerated " +
          "lib/hoodlums-token-factory-artifact.ts, and reload this page before deploying.",
      );
      return;
    }

    const provider = getInjectedEvmProvider();
    if (!provider || !canDeploy) {
      setStatus("Connect the approved owner wallet on chain 46630 and confirm the checklist first.");
      return;
    }

    setBusy(true);
    setStatus("Confirming network and owner match…");
    try {
      const liveChainId = normaliseChainIdHex(
        String(await provider.request({ method: "eth_chainId" })),
      );
      if (!isApprovedFactoryChain(liveChainId)) {
        throw new Error(
          `Deployment blocked: wallet must be on Robinhood Chain Testnet (${ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL}).`,
        );
      }

      const transport = custom(provider);
      const walletClient = createWalletClient({ chain: robinhoodTestnet, transport });
      const publicClient = createPublicClient({ chain: robinhoodTestnet, transport });
      const [liveAccount] = await walletClient.getAddresses();
      if (!isApprovedFactoryOwner(liveAccount)) {
        throw new Error(
          "Deployment blocked: connected wallet does not match the approved factory owner address.",
        );
      }

      setStatus("Review and approve the factory deployment in your wallet…");
      const transactionHash = await walletClient.deployContract({
        account: liveAccount,
        abi: HOODLUMS_TOKEN_FACTORY_ABI,
        bytecode: HOODLUMS_TOKEN_FACTORY_BYTECODE,
        args: [...buildFactoryConstructorArgs()],
      });

      setStatus(`Deployment submitted: ${shortAddress(transactionHash)}. Waiting for confirmation…`);
      const receipt = await publicClient.waitForTransactionReceipt({ hash: transactionHash });
      const parsed = parseFactoryDeploymentResult(receipt, transactionHash);

      setStatus("Reading the deployed factory back on-chain to verify it…");
      const [owner, feeRecipient, launchFee, launchCount] = await Promise.all([
        publicClient.readContract({
          address: parsed.factoryAddress,
          abi: HOODLUMS_TOKEN_FACTORY_ABI,
          functionName: "owner",
        }),
        publicClient.readContract({
          address: parsed.factoryAddress,
          abi: HOODLUMS_TOKEN_FACTORY_ABI,
          functionName: "feeRecipient",
        }),
        publicClient.readContract({
          address: parsed.factoryAddress,
          abi: HOODLUMS_TOKEN_FACTORY_ABI,
          functionName: "launchFee",
        }),
        publicClient.readContract({
          address: parsed.factoryAddress,
          abi: HOODLUMS_TOKEN_FACTORY_ABI,
          functionName: "launchCount",
        }),
      ]);

      const verification = verifyDeployedFactory({
        owner: owner as string,
        feeRecipient: feeRecipient as string,
        launchFee: launchFee as bigint,
        launchCount: launchCount as bigint,
      });

      const record = buildFactoryDeploymentRecord({
        factoryAddress: parsed.factoryAddress,
        transactionHash: parsed.transactionHash,
        verification,
        deployedAtIso: new Date().toISOString(),
      });

      setDeployment({
        factoryAddress: parsed.factoryAddress,
        transactionHash: parsed.transactionHash,
        verification,
        record,
      });
      setStatus(
        verification.allPassed
          ? "Factory deployed and verified on-chain."
          : "Factory transaction confirmed, but on-chain verification failed. Review the checks below before using this address anywhere.",
      );
    } catch (error) {
      setStatus(readError(error));
    } finally {
      setBusy(false);
    }
  }

  async function copyRecord() {
    if (!deployment) return;
    await navigator.clipboard.writeText(JSON.stringify(deployment.record, null, 2));
    setStatus("Deployment record copied to the clipboard.");
  }

  function downloadRecord() {
    if (!deployment) return;
    const blob = new Blob([JSON.stringify(deployment.record, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `hoodlums-token-factory-deployment-${deployment.factoryAddress.toLowerCase()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus("Deployment record downloaded.");
  }

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <Link href="/testnet">← Back to testnet lab</Link>
        <span>TESTNET ONLY · OWNER ONLY</span>
      </header>

      <section className={styles.content}>
        <div className={styles.intro}>
          <p>FACTORY SETUP</p>
          <h1>Deploy HoodlumsTokenFactory<br />on Robinhood Chain Testnet.</h1>
          <p className={styles.lead}>
            This is a one-time, wallet-signed deployment of the existing{" "}
            <code>contracts/HoodlumsTokenFactory.sol</code> for the approved owner only. It does
            not accept a private key or seed phrase, does not sign anything on the server, and
            does not route public token launches through the factory — that is a separate,
            later change.
          </p>
        </div>

        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Approved deployment configuration</h2>
          <dl className={styles.configList}>
            <div><dt>Network</dt><dd>Robinhood Chain Testnet</dd></div>
            <div><dt>Chain ID</dt><dd>{ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL}</dd></div>
            <div><dt>Factory owner</dt><dd>{APPROVED_FACTORY_OWNER_ADDRESS}</dd></div>
            <div><dt>Fee recipient / treasury</dt><dd>{APPROVED_FACTORY_FEE_RECIPIENT_ADDRESS}</dd></div>
            <div><dt>Initial launch fee</dt><dd>0</dd></div>
          </dl>
        </div>

        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Wallet and network checks</h2>

          <button className={styles.walletButton} onClick={connectWallet} disabled={busy}>
            {account ? `Wallet: ${shortAddress(account)}` : "Connect EVM wallet"}
          </button>

          <div className={styles.checklist}>
            <div className={chainOk ? `${styles.checkItem} ${styles.checkPass}` : `${styles.checkItem} ${styles.checkFail}`}>
              <em>Chain ID {ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL}</em>
            </div>
            <div className={ownerOk ? `${styles.checkItem} ${styles.checkPass}` : `${styles.checkItem} ${styles.checkFail}`}>
              <em>Connected wallet matches approved owner</em>
            </div>
            <div className={HOODLUMS_TOKEN_FACTORY_ARTIFACT_READY ? `${styles.checkItem} ${styles.checkPass}` : `${styles.checkItem} ${styles.checkFail}`}>
              <em>Compiled factory bytecode artifact present</em>
            </div>
          </div>

          <label className={styles.confirmation}>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              disabled={busy || Boolean(deployment)}
            />
            <span>
              I understand this deploys a real testnet contract with test ETH only, using the
              exact owner, treasury and zero-fee values above, and does not enable public token
              launches.
            </span>
          </label>

          <div className={styles.status} aria-live="polite">{status}</div>

          {!deployment && (
            <button className={styles.deployButton} onClick={deploy} disabled={!canDeploy}>
              {busy ? "WORKING…" : "DEPLOY FACTORY ON ROBINHOOD TESTNET"}
            </button>
          )}
        </div>

        {deployment && (
          <div className={styles.card}>
            <h2 className={styles.cardTitle}>Deployment result</h2>
            <div className={styles.result}>
              <span>FACTORY ADDRESS</span>
              <code>{deployment.factoryAddress}</code>
              <span>TRANSACTION HASH</span>
              <code>{deployment.transactionHash}</code>
              <div className={styles.linkRow}>
                <a
                  href={`${FACTORY_DEPLOYMENT_EXPLORER_BASE_URL}/address/${deployment.factoryAddress}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View factory contract ↗
                </a>
                <a
                  href={`${FACTORY_DEPLOYMENT_EXPLORER_BASE_URL}/tx/${deployment.transactionHash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View transaction ↗
                </a>
              </div>

              <h2 className={styles.cardTitle}>On-chain verification</h2>
              <div className={styles.checklist}>
                {deployment.verification.checks.map((check) => (
                  <div
                    key={check.label}
                    className={
                      check.passed
                        ? `${styles.checkItem} ${styles.checkPass}`
                        : `${styles.checkItem} ${styles.checkFail}`
                    }
                  >
                    <em>
                      {check.label} — expected {check.expected}, got {check.actual}
                    </em>
                  </div>
                ))}
              </div>

              <div className={styles.recordActions}>
                <button onClick={copyRecord} type="button">Copy deployment record</button>
                <button onClick={downloadRecord} type="button">Download JSON record</button>
              </div>
              <pre className={styles.recordPreview}>{JSON.stringify(deployment.record, null, 2)}</pre>

              <div className={styles.gate}>
                <b>Next manual gate</b>
                {deployment.record.nextManualGate}
              </div>
            </div>
          </div>
        )}
      </section>

      <section className={styles.notes}>
        <article>
          <b>Non-custodial</b>
          <p>No private key or seed phrase field exists. Every action is signed in your selected wallet.</p>
        </article>
        <article>
          <b>Owner-gated</b>
          <p>The deploy action stays disabled unless the connected wallet is the approved owner address.</p>
        </article>
        <article>
          <b>Not wired to public launches</b>
          <p>This page only deploys the factory. /testnet still deploys standalone test tokens until a follow-up change.</p>
        </article>
      </section>
    </main>
  );
}
