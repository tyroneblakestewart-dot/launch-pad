import { ProviderLauncher } from "@/components/provider-launcher";
import { CMS_PREVIEW_QUERY_PARAM, resolvePageContent } from "@/lib/server/page-content";

type ProvidersPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ProvidersPage({ searchParams }: ProvidersPageProps) {
  const { content } = await resolvePageContent(
    "providers",
    (await searchParams)?.[CMS_PREVIEW_QUERY_PARAM],
  );

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
      <ProviderLauncher
        headerEyebrow={content.header_eyebrow}
        headerTitle={content.header_title}
        headerIntro={content.header_intro}
        backToStudioLabel={content.back_to_studio_label}
      />
    </>
  );
}
