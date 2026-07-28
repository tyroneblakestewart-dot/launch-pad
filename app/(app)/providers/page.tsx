import { ProviderLauncher } from "@/components/provider-launcher";

export default function ProvidersPage() {
  return (
    <>
      <style>{`
        main > header > div:last-child,
        main > ol,
        main > ol + section,
        main label:has(input[type="file"]) + div > button:last-child {
          display: none !important;
        }

        @media (min-width: 901px) {
          main label:has(input[type="file"]) + div {
            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
          }
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
