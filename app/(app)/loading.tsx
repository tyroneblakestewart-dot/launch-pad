export default function AppRouteLoading() {
  return (
    <main
      aria-live="polite"
      aria-busy="true"
      style={{
        minHeight: "calc(100vh - 72px)",
        display: "grid",
        placeItems: "center",
        padding: "32px 20px calc(112px + env(safe-area-inset-bottom))",
        background: "#0a0b09",
        color: "#f4f7f1",
      }}
    >
      <div style={{ display: "grid", justifyItems: "center", gap: 10, textAlign: "center" }}>
        <span
          aria-hidden="true"
          style={{ color: "#c6f53e", fontSize: 24, lineHeight: 1 }}
        >
          ◉
        </span>
        <p
          style={{
            margin: 0,
            color: "#c6f53e",
            font: '700 11px "IBM Plex Mono", monospace',
            letterSpacing: "0.12em",
            textTransform: "uppercase",
          }}
        >
          Loading Hoodlums…
        </p>
      </div>
    </main>
  );
}
