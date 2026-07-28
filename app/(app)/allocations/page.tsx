import Link from "next/link";
import { TokenAllocationDesk } from "@/components/token-allocation-desk";

export default function AllocationsPage() {
  return (
    <>
      <TokenAllocationDesk />
      <div style={{ position: "fixed", right: 18, bottom: 18, zIndex: 20 }}>
        <Link
          href="/liquidity-lab"
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
          Open Testnet Liquidity Lab →
        </Link>
      </div>
    </>
  );
}
