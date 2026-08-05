import { cookies } from "next/headers";
import { AdminDashboard } from "@/components/admin-dashboard";
import { AdminLoginScreen } from "@/components/admin-login-screen";
import { ADMIN_SESSION_COOKIE } from "@/lib/server/admin-auth";
import { isAdminSessionTokenValid } from "@/lib/server/admin-session-store";
import { CMS_PREVIEW_QUERY_PARAM, resolvePageContent } from "@/lib/server/page-content";

export const dynamic = "force-dynamic";

/** Pure gate for which screen renders — testable without a live request scope. */
export async function isAdminSessionTokenAuthenticated(
  token: string | undefined,
): Promise<boolean> {
  return isAdminSessionTokenValid(token);
}

type AdminPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminPage({ searchParams }: AdminPageProps) {
  const token = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value;
  if (await isAdminSessionTokenAuthenticated(token)) {
    return <AdminDashboard />;
  }

  const { content } = await resolvePageContent(
    "admin-login",
    (await searchParams)?.[CMS_PREVIEW_QUERY_PARAM],
  );

  return (
    <AdminLoginScreen
      headerTitle={content.header_title}
      headerSubtitle={content.header_subtitle}
      walletTabLabel={content.wallet_tab_label}
      passwordTabLabel={content.password_tab_label}
      walletButtonLabel={content.wallet_button_label}
      passwordPlaceholder={content.password_placeholder}
      passwordButtonLabel={content.password_button_label}
    />
  );
}
