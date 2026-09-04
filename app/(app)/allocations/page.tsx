import Link from "next/link";
import { AccountOverlayShell } from "@/components/account-overlay-shell";
import { TokenAllocationDesk } from "@/components/token-allocation-desk";
import { isContentVisible } from "@/lib/page-content-registry";
import { CMS_PREVIEW_QUERY_PARAM, resolvePageContent } from "@/lib/server/page-content";

type AllocationsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AllocationsPage({ searchParams }: AllocationsPageProps) {
  const { content } = await resolvePageContent(
    "allocations",
    (await searchParams)?.[CMS_PREVIEW_QUERY_PARAM],
  );

  return (
    <>
      <AccountOverlayShell />
      <TokenAllocationDesk
        headerEyebrow={content.header_eyebrow}
        headerTitle={content.header_title}
        headerIntro={content.header_intro}
      />
      {isContentVisible(content.liquidity_cta_visible) ? (
        <div style={{ position: "fixed", right: 18, bottom: 18, zIndex: 20 }}>
          <Link
            href={content.liquidity_cta_link}
            style={{
              display: "inline-flex",
              padding: "12px 16px",
              borderRadius: 9,
              background: "#bce759",
              color: "#071006",
              fontWeight: 900,
              textDecoration: "none",
              boxShadow: "0 12px 30px rgba(0,0,0,.35)",
            }}
          >
            {content.liquidity_cta_label}
          </Link>
        </div>
      ) : null}
    </>
  );
}
