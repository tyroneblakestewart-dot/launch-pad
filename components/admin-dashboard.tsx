"use client";

import { useCallback, useState } from "react";
import { AdminSystemHealth } from "@/components/admin-system-health";
import styles from "./admin-dashboard.module.css";

type SectionId = "system-health";

// Only System Health ships for now. Add future sections (Activity, Money,
// Issues) here — the nav and content switch below need no other changes.
const SECTIONS: ReadonlyArray<{ id: SectionId; label: string }> = [
  { id: "system-health", label: "System Health" },
];

async function signOutOfAdmin(): Promise<void> {
  const response = await fetch("/api/admin/logout", {
    method: "POST",
    credentials: "same-origin",
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(payload.error || "Admin sign-out failed.");
  }
}

export function AdminDashboard() {
  const [activeSection, setActiveSection] =
    useState<SectionId>("system-health");
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = useCallback(async () => {
    setSigningOut(true);
    try {
      await signOutOfAdmin();
      window.location.replace("/admin");
    } finally {
      setSigningOut(false);
    }
  }, []);

  return (
    <main className={styles.dashboard}>
      <header className={styles.header}>
        <h1 className={styles.title}>HOODLUMS Admin</h1>
        <button
          type="button"
          className={styles.signOutButton}
          onClick={() => void handleSignOut()}
          disabled={signingOut}
        >
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </header>

      <nav className={styles.nav} aria-label="Dashboard sections">
        {SECTIONS.map((section) => (
          <button
            key={section.id}
            type="button"
            className={
              section.id === activeSection
                ? styles.navItemActive
                : styles.navItem
            }
            onClick={() => setActiveSection(section.id)}
          >
            {section.label}
          </button>
        ))}
      </nav>

      <section className={styles.content}>
        {activeSection === "system-health" ? <AdminSystemHealth /> : null}
      </section>
    </main>
  );
}
