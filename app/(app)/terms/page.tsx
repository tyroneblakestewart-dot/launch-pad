import type { Metadata } from "next";
import Link from "next/link";
import { CMS_PREVIEW_QUERY_PARAM, resolvePageContent } from "@/lib/server/page-content";
import styles from "./terms.module.css";

export const metadata: Metadata = {
  title: "Terms of Use | HOODLUMS",
  description:
    "The conditions, responsibilities, and risks that apply when you access or use the HOODLUMS interface.",
  alternates: { canonical: "/terms" },
};

type TermsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

// A block is either a paragraph, a bullet list, or an all-caps emphasis
// paragraph (used for the arbitration class-action waiver).
type Block =
  | { kind: "p"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "caps"; text: string };

type Section = { title: string; blocks: Block[] };

const p = (text: string): Block => ({ kind: "p", text });
const list = (items: string[]): Block => ({ kind: "list", items });
const caps = (text: string): Block => ({ kind: "caps", text });

// Placeholders the owner fills in before publishing. Kept as obvious tokens so
// they are easy to find (and impossible to mistake for a real entity).
const ENTITY = "[LEGAL ENTITY NAME]";
const CONTACT = "legal@hoodlums.dev";

const SECTIONS: Section[] = [
  {
    title: "Agreement",
    blocks: [
      p(
        `These Terms of Use are an agreement between you and ${ENTITY} ("HOODLUMS," "we," "us," or "our"). They govern your access to and use of hoodlums.dev, the HOODLUMS interface, and all related features, content, and services (the "Platform").`,
      ),
      p(
        "By accessing or using the Platform, connecting a wallet, or submitting a transaction through the interface, you confirm that you have read and accepted these Terms and the Privacy Policy. If you do not agree, do not use the Platform.",
      ),
    ],
  },
  {
    title: "About HOODLUMS",
    blocks: [
      p(
        "HOODLUMS operates the Platform and provides a software interface for creating, discovering, and interacting with fixed-supply tokens and public blockchain networks, wallets, smart contracts, liquidity pools, bonding curves, and third-party services. The Platform also includes tools that generate token websites and let creators publish them to a public address.",
      ),
      p(`Questions about these Terms may be sent to ${ENTITY} at ${CONTACT}.`),
    ],
  },
  {
    title: "Eligibility",
    blocks: [
      p(
        "You must be 18 years of age or older (or older than 18 if the age of majority in your jurisdiction is greater than 18) and have sufficient legal capacity and authority to enter into these Terms. If you are using HOODLUMS on behalf of an entity, you represent and warrant that you have the authority to bind that entity to these Terms.",
      ),
      p(
        "HOODLUMS is available only in jurisdictions where such use is lawful under applicable law. By using the Platform, you represent and warrant that:",
      ),
      list([
        "Your use of the Platform is lawful in your jurisdiction;",
        "You are not relying on HOODLUMS for any brokerage, advisory, execution, or other regulated financial service;",
        "You will comply with all applicable laws, including securities, commodities, anti-money laundering, and sanctions regulations.",
      ]),
      p(
        'HOODLUMS is not available to persons who reside in, are located in, are incorporated in, or have a registered office in any of the following jurisdictions ("Restricted Jurisdictions"):',
      ),
      list([
        "Cuba",
        "Iran",
        "North Korea",
        "Syria",
        "Russia",
        "Belarus",
        "The Crimea, Donetsk, and Luhansk regions of Ukraine",
        "Myanmar (Burma)",
        "Venezuela",
        "Any jurisdiction subject to comprehensive economic sanctions administered by the United Nations, OFAC, the European Union, or the United Kingdom",
      ]),
      p(
        "By using HOODLUMS, you represent and warrant that you are not located in a Restricted Jurisdiction, that you are not a person or entity identified on any applicable sanctions or restricted-party list (including those referenced in this section), and that your use of the Platform complies with all applicable laws in your jurisdiction. HOODLUMS reserves the right to update the list of Restricted Jurisdictions at any time in response to changes in applicable law or regulatory guidance.",
      ),
      p(
        'Without limiting the foregoing, HOODLUMS is not available to any person or entity designated as a "Specially Designated National" by OFAC, placed on the U.S. Commerce Department\'s Denied Persons List, listed on the UN Security Council Consolidated Sanctions List, or subject to equivalent designations under the sanctions regimes of Canada, the United Kingdom, the European Union, or Switzerland.',
      ),
      p(
        "HOODLUMS may restrict or discontinue access where reasonably necessary for legal, security, operational, or risk reasons, including where HOODLUMS reasonably believes a user is located in a Restricted Jurisdiction.",
      ),
    ],
  },
  {
    title: "Noncustodial interface",
    blocks: [
      p(
        "HOODLUMS is a noncustodial interface. HOODLUMS does not hold your assets or private keys, control your wallet, execute transactions on your behalf, guarantee settlement, or have the ability to reverse a blockchain transaction.",
      ),
      p(
        "HOODLUMS is not a bank, broker, exchange, custodian, investment adviser, fiduciary, money transmitter, or financial institution. Nothing available through the Platform is financial, investment, legal, accounting, or tax advice.",
      ),
      p(
        "Every transaction is initiated and authorized through your wallet. Smart contracts and blockchain networks, rather than HOODLUMS, determine whether and how a transaction executes.",
      ),
    ],
  },
  {
    title: "Wallets and account security",
    blocks: [
      p(
        "HOODLUMS will never ask for your private key or recovery phrase. HOODLUMS cannot restore a wallet, recover assets, cancel approvals, or assist with transactions signed through a compromised wallet.",
      ),
      list([
        "Protect your wallet, private keys, recovery phrase, devices, and authentication methods.",
        "Review transaction details, token addresses, approvals, fees, slippage, and network before signing.",
        "Use only wallets and devices you trust.",
        "Accept responsibility for activity authorized through your wallet, including unauthorized access caused by compromised credentials or devices.",
      ]),
    ],
  },
  {
    title: "Transactions",
    blocks: [
      p(
        "Before signing, you are responsible for reviewing every transaction and understanding its effects. Displayed quotes, prices, market capitalizations, fees, balances, simulations, and transaction outcomes are estimates and may be delayed, incomplete, or different from final execution.",
      ),
      p(
        "Blockchain transactions may be irreversible. Transactions may fail, remain pending, execute at an unexpected price, or be reordered due to network conditions, liquidity, slippage, smart contract behavior, or third-party systems.",
      ),
      p(
        "HOODLUMS does not guarantee that a submitted transaction will be included, confirmed, completed, or completed within a particular time.",
      ),
    ],
  },
  {
    title: "Token launches and content",
    blocks: [
      p(
        "You are solely responsible for tokens you create or promote and for names, symbols, descriptions, images, links, profile information, chat messages, generated websites, and other content you submit, generate, or publish through the Platform.",
      ),
      p(
        "The Platform includes tools that use automated and AI systems to help generate token websites, styles, and page content. Generated output may be inaccurate, incomplete, or unexpected, and you are responsible for reviewing, editing, and confirming that any content you generate and publish is accurate, lawful, non-infringing, and not misleading before you make it public.",
      ),
      p(
        "You represent that you have all rights and permissions needed for submitted content and that it is accurate, lawful, and not misleading. Token creation does not mean that HOODLUMS has reviewed, sponsored, endorsed, or approved the token or its creator.",
      ),
      p(
        "HOODLUMS may hide, restrict, or remove offchain content from surfaces under its control if, in HOODLUMS's sole discretion, it violates these Terms, creates legal or security risk, or interferes with the service. HOODLUMS has no obligation to monitor, review, or screen user content or activity. HOODLUMS cannot remove content or transactions recorded on a public blockchain or independent distributed storage.",
      ),
      p(
        "HOODLUMS may feature, surface, or rank tokens on the interface using neutral, criteria-based methods (including trading volume, activity, or recency). Featuring a token in this manner is not, and should not be construed as, an endorsement, recommendation, or statement regarding the value, safety, or legitimacy of that token or its creator.",
      ),
    ],
  },
  {
    title: "Trading and liquidity",
    blocks: [
      p(
        "Tokens, bonding-curve positions, and liquidity positions available through the Platform may be volatile, experimental, illiquid, malicious, or worthless. Anyone may create or trade assets with similar names or symbols. Verify contract addresses before interacting.",
      ),
      p(
        "Providing liquidity, buying or selling on a bonding curve, or placing a range or limit order may expose you to impermanent loss, price movement, partial execution, out-of-range positions, smart contract risk, and loss of principal. Orders may require a separate claim or withdrawal transaction after execution.",
      ),
      p(
        "HOODLUMS does not guarantee liquidity, market depth, token value, graduation, order execution, counterparties, or the ability to exit a position.",
      ),
    ],
  },
  {
    title: "Risk disclosures",
    blocks: [
      p(
        "You are responsible for your own research, risk assessment, and decisions. Only use assets you can afford to lose. You expressly acknowledge and assume the risks described in this section and throughout these Terms.",
      ),
      list([
        "You may lose some or all assets used through HOODLUMS.",
        "Smart contracts may contain defects, vulnerabilities, or unexpected behavior, and may be unaudited.",
        "Wallets, RPC services, bridges, indexers, networks, price sources, AI and generation services, and storage providers may fail or become unavailable.",
        "Market data may be inaccurate, delayed, manipulated, or incomplete.",
        "Tokens and transactions may have legal, tax, accounting, or regulatory consequences.",
        "Network upgrades, forks, congestion, reorganizations, or validator conduct may affect transactions and assets.",
      ]),
      p(
        "Certain features of the Platform currently operate on test networks (including Robinhood Chain Testnet, chain ID 46630, and Monad Testnet, chain ID 10143). Tokens, balances, and transactions on a test network have no monetary value and are provided for testing and demonstration only. Availability of features on any particular network may change over time.",
      ),
      p(
        "HOODLUMS makes no representation regarding the legal or regulatory status of any token available through the interface, including whether it constitutes a security under the laws of any jurisdiction. Nothing on the Platform is an offer or solicitation to buy or sell any token, and no statement by HOODLUMS, its personnel, or any token creator should be construed as investment, financial, or trading advice or as a prediction or guarantee of profit, return, or appreciation.",
      ),
    ],
  },
  {
    title: "Fees and taxes",
    blocks: [
      p(
        "Transactions may incur network fees, protocol fees, trading fees, liquidity costs, price impact, slippage, or third-party charges. Displayed estimates may differ from the final amount.",
      ),
      p(
        "You are solely responsible for identifying, reporting, and paying taxes, duties, and other governmental charges arising from your use of the Platform.",
      ),
    ],
  },
  {
    title: "Acceptable use",
    blocks: [
      p(
        "HOODLUMS may investigate suspected misuse and cooperate with lawful requests. Offchain access or content may be restricted without limiting any other available right or remedy.",
      ),
      list([
        "Do not violate law, sanctions, intellectual property rights, privacy rights, or the rights of others.",
        "Do not publish fraudulent, deceptive, abusive, illegal, or malicious token metadata, generated content, links, or messages.",
        "Do not interfere with the interface, bypass access controls, distribute malware, scrape abusively, or overload supporting infrastructure.",
        "Do not misrepresent affiliation with the Platform or use the interface to facilitate market manipulation, theft, or other unlawful conduct.",
        "Do not exploit vulnerabilities, manipulate displayed data, evade rate limits, or use automated systems in a manner that harms users or infrastructure.",
        "Do not use the Platform to launder funds, finance unlawful activity, defraud others, or conceal proceeds of crime.",
        "Do not use the Platform, or create or promote any token through the Platform, in connection with any capital raise, pooled investment scheme, profit-sharing arrangement, revenue participation right, tokenized equity or debt representation, or any other arrangement intended to represent an ownership, creditor, or investment interest in an ongoing business or enterprise.",
      ]),
    ],
  },
  {
    title: "Material interests and conflicts",
    blocks: [
      p(
        "HOODLUMS and its affiliates may from time to time hold, trade, feature, or otherwise have an interest in tokens available through the Platform, and may act in more than one capacity in connection with the interface. You agree that HOODLUMS may do so, and that nothing in these Terms or in HOODLUMS's relationship with you gives rise to a fiduciary, advisory, or similar duty on HOODLUMS's part.",
      ),
      p(
        "HOODLUMS may maintain organizational measures designed to identify and manage conflicts of interest between HOODLUMS and users, but is not obligated to disclose its own transactions, holdings, or interests in any token, and reserves the right to decline to act where a conflict cannot reasonably be managed.",
      ),
    ],
  },
  {
    title: "Transaction and activity limits",
    blocks: [
      p(
        "HOODLUMS may impose limits on transaction size, frequency, or other account or wallet activity at any time, in its discretion, for risk management, security, legal, or operational reasons.",
      ),
    ],
  },
  {
    title: "Third-party services",
    blocks: [
      p(
        "The Platform connects to independent wallets, blockchain networks, smart contracts, bridges, liquidity protocols, RPC providers, indexers, explorers, data sources, AI and content-generation services, storage systems, and websites. Their availability, accuracy, security, conduct, and terms are outside HOODLUMS's control.",
      ),
      p(
        "A link or integration does not mean that HOODLUMS sponsors, controls, or endorses the third party. Your use of a third-party service is governed by its own terms and policies.",
      ),
    ],
  },
  {
    title: "Intellectual property",
    blocks: [
      p(
        "The Platform interface, branding, design, documentation, and original software content are protected by applicable intellectual property laws. These Terms grant you a limited, revocable, nonexclusive, nontransferable right to access and use the interface for lawful purposes.",
      ),
      p(
        "Except where separate open-source terms apply, you may not copy, modify, sell, sublicense, or create derivative works or services from protected HOODLUMS materials without permission.",
      ),
      p(
        `If you believe content accessible through the Platform infringes your copyright, you may submit a notice to HOODLUMS at ${CONTACT}. Your notice must include: (i) identification of the copyrighted work claimed to be infringed; (ii) identification of the material claimed to be infringing and its location on the Platform; (iii) your contact information; (iv) a statement that you have a good faith belief that the use is not authorized by the copyright owner, its agent, or the law; (v) a statement, made under penalty of perjury, that the notice is accurate and that you are authorized to act on behalf of the copyright owner; and (vi) your physical or electronic signature. HOODLUMS will respond to compliant notices in accordance with applicable law, which may include removing or disabling access to the identified material and, where applicable, providing you a mechanism to submit a counter-notice.`,
      ),
    ],
  },
  {
    title: "Submitted content",
    blocks: [
      p(
        "You retain any rights you hold in content you submit. You grant HOODLUMS a worldwide, nonexclusive, royalty-free, sublicensable license to host, store, reproduce, display, format, transmit, and moderate that content as reasonably necessary to operate, secure, and promote the relevant Platform features.",
      ),
      p(
        "This license continues for content that remains on public blockchain networks, distributed storage, backups, or records reasonably retained for legal and security purposes.",
      ),
    ],
  },
  {
    title: "Feedback",
    blocks: [
      p(
        "If you provide suggestions or feedback, you grant HOODLUMS an irrevocable, perpetual, worldwide, royalty-free license to use, modify, and incorporate it without restriction or compensation. Do not submit confidential information as feedback.",
      ),
    ],
  },
  {
    title: "Service availability",
    blocks: [
      p(
        "HOODLUMS may add, modify, suspend, restrict, or discontinue any feature or the interface at any time. HOODLUMS does not guarantee continuous availability, compatibility with a wallet or network, preservation of offchain data, or advance notice of changes.",
      ),
      p(
        "You remain able to interact directly with compatible public networks and smart contracts without the Platform interface, subject to those systems and your own technical ability.",
      ),
    ],
  },
  {
    title: "No warranties",
    blocks: [
      p(
        'To the fullest extent permitted by law, the Platform is provided "as is" and "as available," without warranties of any kind, whether express, implied, or statutory. HOODLUMS disclaims warranties of merchantability, fitness for a particular purpose, title, noninfringement, accuracy, availability, security, and uninterrupted operation.',
      ),
      p(
        "HOODLUMS does not warrant that tokens, content, generated output, data, smart contracts, transactions, or third-party services are accurate, legitimate, safe, complete, or free from defects.",
      ),
    ],
  },
  {
    title: "Limitation of liability",
    blocks: [
      p(
        "To the fullest extent permitted by law, HOODLUMS and its affiliates, officers, directors, employees, agents, and service providers will not be liable for indirect, incidental, special, consequential, exemplary, or punitive damages, lost profits, lost data, loss of assets, failed or delayed transactions, smart contract defects, wallet compromise, network events, price movement, market manipulation, or third-party conduct.",
      ),
      p(
        "To the fullest extent permitted by law, the total aggregate liability of HOODLUMS and its affiliates, officers, directors, employees, agents, and service providers for claims arising from or relating to the Platform will not exceed the greater of the fees you paid directly to HOODLUMS for use of the interface during the twelve months before the event giving rise to the claim or one hundred United States dollars.",
      ),
      p(
        "Some jurisdictions do not allow certain exclusions or limitations. In those jurisdictions, liability is limited only to the extent permitted by law.",
      ),
    ],
  },
  {
    title: "Indemnification",
    blocks: [
      p(
        "To the fullest extent permitted by law, you agree to defend, indemnify, and hold harmless HOODLUMS and its affiliates, officers, directors, employees, agents, and service providers from claims, losses, liabilities, damages, judgments, costs, and reasonable legal fees arising from your use of the Platform, your submitted or generated content, your violation of these Terms, or your violation of law or another person's rights.",
      ),
      p(
        "You irrevocably release HOODLUMS and its affiliates, officers, directors, employees, agents, and service providers from any claim or demand arising out of or connected with any dispute you have with another user or a third party in connection with the Platform, including disputes relating to a token, its creator, or a transaction.",
      ),
    ],
  },
  {
    title: "Termination and restriction of access",
    blocks: [
      p(
        "In addition to any restriction described elsewhere in these Terms, HOODLUMS may terminate, suspend, or restrict your access to the Platform at any time, with or without notice, including where HOODLUMS reasonably suspects fraud, market manipulation, sanctions or legal risk, a violation of these Terms, coordinated or automated abuse, or any other conduct presenting elevated risk to HOODLUMS, other users, or the integrity of the interface. The grounds described in this section are illustrative and not exhaustive, and HOODLUMS's decision to terminate, suspend, or restrict access may rely on confidential risk and security criteria that HOODLUMS is not obligated to disclose. The sections addressing eligibility, the noncustodial interface, risk disclosures, fees and taxes, acceptable use, material interests, intellectual property, submitted content, feedback, warranties, limitation of liability, indemnification, dispute resolution, and general terms, and any other provisions that by their nature should survive, will survive any termination or expiration of these Terms.",
      ),
    ],
  },
  {
    title: "Governing law and dispute resolution",
    blocks: [
      p(
        `Before starting a formal claim relating to the Platform, you agree to contact HOODLUMS at ${CONTACT} and provide a reasonable description of the dispute. You and HOODLUMS will attempt in good faith to resolve the matter informally.`,
      ),
      p(
        "These Terms and any dispute, claim, or controversy arising out of or relating to these Terms, your use of the Platform, or the relationship between you and HOODLUMS are governed by the laws of the State of Georgia, without regard to its conflict of laws principles.",
      ),
      p(
        'Any dispute not resolved informally within 60 days will be resolved exclusively through final and binding arbitration on an individual basis, rather than in court, administered by the American Arbitration Association ("AAA") under its rules applicable to consumer or commercial disputes as appropriate, with the arbitration seated in Atlanta, Georgia, or, at the election of either party, conducted by video conference. The arbitrator may grant any relief that a court of competent jurisdiction could grant, consistent with the limitations set forth in these Terms, and the arbitrator\'s award is final and binding and may be entered as a judgment in any court of competent jurisdiction.',
      ),
      caps(
        "YOU AND HOODLUMS AGREE THAT ANY CLAIM MUST BE BROUGHT INDIVIDUALLY AND NOT AS A PLAINTIFF OR CLASS MEMBER IN ANY PURPORTED CLASS, COLLECTIVE, REPRESENTATIVE, OR CONSOLIDATED PROCEEDING. THE ARBITRATOR MAY NOT CONSOLIDATE MORE THAN ONE PERSON'S CLAIMS AND MAY NOT OTHERWISE PRESIDE OVER ANY FORM OF A CLASS OR REPRESENTATIVE PROCEEDING.",
      ),
      p(
        "If this arbitration agreement is found not to apply to you or your claim, you agree that any judicial proceeding (other than small claims actions) will be brought exclusively in the state or federal courts located in Atlanta, Georgia, and you consent to personal jurisdiction and venue there.",
      ),
      p(
        `You may opt out of this arbitration agreement by sending written notice to ${CONTACT} within 30 days of first accepting these Terms, including your full name, wallet address or account identifier, and a clear statement that you wish to opt out of arbitration.`,
      ),
      p("Nothing in this section limits rights that cannot be waived under applicable law."),
    ],
  },
  {
    title: "General terms",
    blocks: [
      p(
        "If a provision of these Terms is found unenforceable, the remaining provisions continue in effect. A failure to enforce a provision is not a waiver. Headings are for convenience and do not change meaning.",
      ),
      p(
        "You may not assign your rights under these Terms without HOODLUMS's consent. HOODLUMS may freely assign or transfer these Terms or any of its rights or obligations hereunder without restriction or notice.",
      ),
      p(
        "These Terms and the Privacy Policy constitute the agreement between you and HOODLUMS concerning the interface, except where additional terms are presented for a specific feature.",
      ),
    ],
  },
  {
    title: "Changes to these Terms",
    blocks: [
      p(
        "HOODLUMS may update these Terms as the interface, risks, or legal requirements change. The effective date identifies the current version. Material changes may be communicated through the interface or another appropriate channel.",
      ),
      p(
        "Continued use after revised Terms become effective means that you accept the revised Terms for later activity. If you do not agree, stop using the Platform.",
      ),
    ],
  },
  {
    title: "Contact",
    blocks: [p(`Questions about these Terms may be sent to ${ENTITY} at ${CONTACT}.`)],
  },
];

function pad(index: number): string {
  return String(index + 1).padStart(2, "0");
}

function SectionBody({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((block, index) => {
        if (block.kind === "list") {
          return (
            <ul key={index} className={styles.list}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{item}</li>
              ))}
            </ul>
          );
        }
        if (block.kind === "caps") {
          return (
            <p key={index} className={styles.caps}>
              {block.text}
            </p>
          );
        }
        return <p key={index}>{block.text}</p>;
      })}
    </>
  );
}

export default async function TermsPage({ searchParams }: TermsPageProps) {
  const { content } = await resolvePageContent(
    "terms",
    (await searchParams)?.[CMS_PREVIEW_QUERY_PARAM],
  );

  return (
    <main className={styles.page}>
      <article className={styles.panel}>
        <header className={styles.header}>
          <p className={styles.eyebrow}>{content.eyebrow}</p>
          <h1>{content.title}</h1>
          <p className={styles.intro}>{content.intro}</p>
          <p className={styles.effective}>{content.effective_date}</p>
        </header>

        <div className={styles.placeholderNote} role="note">
          <b>Draft — not legal advice.</b> This document adapts a public terms-of-use structure for
          HOODLUMS and still contains placeholders ({ENTITY} and {CONTACT}). Replace the registered
          entity name and contact email, and have it reviewed by a qualified attorney, before relying
          on it. It describes forward-looking functionality; some features currently run on test
          networks only.
        </div>

        <nav className={styles.toc} aria-label="On this page">
          <p className={styles.tocHeading}>On this page</p>
          <ol>
            {SECTIONS.map((section, index) => (
              <li key={section.title}>
                <a href={`#section-${index + 1}`}>
                  <span>{pad(index)}</span>
                  {section.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className={styles.sections}>
          {SECTIONS.map((section, index) => (
            <section key={section.title} id={`section-${index + 1}`} className={styles.section}>
              <div className={styles.sectionHeading}>
                <span className={styles.sectionNumber}>{pad(index)}</span>
                <h2>{section.title}</h2>
              </div>
              <div className={styles.sectionBody}>
                <SectionBody blocks={section.blocks} />
              </div>
            </section>
          ))}
        </div>

        <footer className={styles.footer}>
          <p>
            Questions about this document? <a href={`mailto:${CONTACT}`}>{CONTACT}</a>
          </p>
          <Link href="/" className={styles.backLink}>
            Return to HOODLUMS
          </Link>
        </footer>
      </article>
    </main>
  );
}
