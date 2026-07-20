import { ProviderLauncher } from "@/components/provider-launcher";

export default function ProvidersPage() {
  return (
    <>
      <style>{`
        main > header > div:last-child,
        main > ol,
        main > ol + section {
          display: none !important;
        }

        @media (max-width: 900px) {
          main > header + div {
            display: none !important;
          }
        }
      `}</style>
      <ProviderLauncher />
    </>
  );
}
