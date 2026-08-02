import { cookies } from "next/headers";
import { AdminDashboard } from "@/components/admin-dashboard";
import { AdminLoginScreen } from "@/components/admin-login-screen";
import {
  ADMIN_SESSION_COOKIE,
  hashAdminSessionToken,
} from "@/lib/server/admin-auth";
import { isAdminSessionValid } from "@/lib/server/admin-session-store";

export const dynamic = "force-dynamic";

/** Pure gate for which screen renders — testable without a live request scope. */
export async function isAdminSessionTokenAuthenticated(
  token: string | undefined,
): Promise<boolean> {
  if (!token) return false;
  try {
    return await isAdminSessionValid(hashAdminSessionToken(token));
  } catch {
    // Fail closed if Postgres is unavailable or the admin migration is absent.
    return false;
  }
}

export default async function AdminPage() {
  const token = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value;
  return (await isAdminSessionTokenAuthenticated(token)) ? (
    <AdminDashboard />
  ) : (
    <AdminLoginScreen />
  );
}
