import Link from "next/link";
import { TokenStudio } from "@/components/token-studio";

const floatingLink = {
  position: "fixed" as const,
  right: 18,
  zIndex: 80,
  padding: "12px 15px",
  border: "1px solid rgba(85,255,120,.48)",
  borderRadius: 8,
  color: "#071008",
  background: "#55ff78",
  boxShadow: "0 12px 35px rgba(0,0,0,.4)",
  font: '800 10px "IBM Plex Mono", monospace',
};

export default function Home() {
  return (
    <>
      <Link href="/providers" style={{ ...floatingLink, bottom: 70 }}>
        NOXA + PONS LAUNCH ↗
      </Link>
      <Link href="/testnet" style={{ ...floatingLink, bottom: 18 }}>
        OPEN TESTNET LAB ↗
      </Link>
      <TokenStudio />
    </>
  );
}
