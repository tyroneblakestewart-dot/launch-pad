import { ProviderLauncher } from "@/components/provider-launcher";

export default function ProvidersPage() {
  return (
    <>
      <style>{`
        main > ol {
          display: none !important;
        }

        main > ol + section {
          max-width: 1400px;
          margin: 0 auto 18px;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }

        main > ol + section > button {
          min-height: 50px;
          padding: 10px 14px !important;
          border-radius: 10px !important;
          text-align: center !important;
        }

        main > ol + section > button > span {
          margin: 0 !important;
          font-size: 15px !important;
        }

        main > ol + section > button > b,
        main > ol + section > button > small {
          display: none !important;
        }

        @media (max-width: 900px) {
          main > header + div {
            display: none !important;
          }

          main > ol + section {
            margin-bottom: 12px;
          }
        }
      `}</style>
      <ProviderLauncher />
    </>
  );
}
