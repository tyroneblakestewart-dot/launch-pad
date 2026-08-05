import { ManagerPlans } from "@/components/manager-plans";
import { CMS_PREVIEW_QUERY_PARAM, resolvePageContent } from "@/lib/server/page-content";

type ManagerPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ManagerPage({ searchParams }: ManagerPageProps) {
  const { content } = await resolvePageContent(
    "manager",
    (await searchParams)?.[CMS_PREVIEW_QUERY_PARAM],
  );

  return (
    <ManagerPlans
      headerEyebrow={content.header_eyebrow}
      headerTitle={content.header_title}
      headerIntro={content.header_intro}
    />
  );
}
