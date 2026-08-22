"use client";

import { useEffect, useState } from "react";
import {
  hasAdminSupportNews,
  readAdminSupportLastSeen,
  writeAdminSupportLastSeen,
  type AdminSupportActivityTicket,
} from "@/lib/admin-support-unread";

// /admin Support tab red-dot check (issue #405). Mirrors
// lib/use-support-unread.ts's module-level singleton shape (one cached
// value, one in-flight fetch, subscriber set) so multiple mounts of
// AdminDashboard never double the request count. Checked on initial /admin
// load and window focus only — no new polling beyond the dashboard's
// existing 30s operations refresh, which is a different endpoint on a
// different cadence and is deliberately not reused here.

let cachedUnread = false;
const listeners = new Set<(value: boolean) => void>();
let inFlight: Promise<void> | null = null;

function notify(value: boolean): void {
  cachedUnread = value;
  listeners.forEach((listener) => listener(value));
}

async function refreshAdminSupportUnread(): Promise<void> {
  if (inFlight) {
    await inFlight;
    return;
  }

  inFlight = (async () => {
    try {
      const response = await fetch("/api/admin/support?status=all", { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) {
        // Never a false alert on a failed, unauthenticated or rate-limited check.
        notify(false);
        return;
      }
      const payload = (await response.json().catch(() => null)) as { tickets?: AdminSupportActivityTicket[] } | null;
      if (!payload || !Array.isArray(payload.tickets)) {
        notify(false);
        return;
      }
      notify(hasAdminSupportNews(payload.tickets, readAdminSupportLastSeen()));
    } catch {
      notify(false);
    }
  })();

  try {
    await inFlight;
  } finally {
    inFlight = null;
  }
}

/** Called once the Support section's own listing has loaded successfully (issue #405) — clears the dot immediately, the moment current support data has actually been observed, rather than waiting for the next focus/mount check. */
export function markAdminSupportSeen(): void {
  writeAdminSupportLastSeen(Date.now());
  notify(false);
}

export function useAdminSupportUnread(): boolean {
  const [unread, setUnread] = useState(cachedUnread);

  useEffect(() => {
    listeners.add(setUnread);
    void refreshAdminSupportUnread();

    function handleFocus() {
      void refreshAdminSupportUnread();
    }
    window.addEventListener("focus", handleFocus);

    return () => {
      listeners.delete(setUnread);
      window.removeEventListener("focus", handleFocus);
    };
  }, []);

  return unread;
}
