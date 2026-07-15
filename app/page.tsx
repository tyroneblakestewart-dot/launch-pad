import { TokenStudio } from "@/components/token-studio";

export default function Home() {
  return (
    <>
      <a
        href="/testnet"
        style={{
          position: "fixed",
          right: 18,
          bottom: 18,
          zIndex: 80,
          padding: "12px 15px",
          border: "1px solid rgba(85,255,120,.48)",
          borderRadius: 8,
          color: "#071008",
          background: "#55ff78",
          boxShadow: "0 12px 35px rgba(0,0,0,.4)",
          font: '800 10px "IBM Plex Mono", monospace',
        }}
      >
        OPEN TESTNET LAB ↗
      </a>
      <TokenStudio />
    </>
  );
}
