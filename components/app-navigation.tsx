/* eslint-disable @next/next/no-img-element */
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HOODLUMS_WORDMARK_IMAGE } from "@/lib/hoodlums-wordmark-image";
import styles from "./app-navigation.module.css";

const NAV_ITEMS = [
  { href: "/", label: "Studio", icon: "studio", step: "1", description: "Create or open a token" },
  { href: "/providers", label: "Providers", icon: "wallet", step: "2", description: "Choose the launch provider" },
  { href: "/allocations", label: "Allocations", icon: "allocate", step: "3", description: "Plan token distribution" },
  { href: "/liquidity-lab", label: "Liquidity Lab", icon: "liquidity", step: "4", description: "Test the token pool" },
] as const;

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href);
}

function NavIcon({ name }: { name: (typeof NAV_ITEMS)[number]["icon"] }) {
  if (name === "studio") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 14.5zM8 20h8M12 16v4" /></svg>;
  }
  if (name === "wallet") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7Zm0 0 2-2h10M16 11h4v4h-4a2 2 0 1 1 0-4Z" /></svg>;
  }
  if (name === "allocate") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5v14M17 5v14M4 9h6M14 15h6M7 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" /></svg>;
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v5.2c0 .5-.2 1-.6 1.4L4.8 11.2a4 4 0 0 0 0 5.6l2.4 2.4a4 4 0 0 0 5.6 0l6.4-6.4a4 4 0 0 0 0-5.6l-2.4-2.4a4 4 0 0 0-5.6 0L9.6 6.4M14 8l2 2M9 13l2 2" /></svg>;
}

export function AppNavigation() {
  const pathname = usePathname();

  return (
    <>
      <aside className={styles.sidebar} aria-label="Launch workflow navigation">
        <Link href="/" className={styles.brand}>
          <span>H</span>
          <div><b>HOODLUMS</b><small>Launch workspace</small></div>
        </Link>
        <p className={styles.eyebrow}>LAUNCH FLOW</p>
        <nav className={styles.sideNav}>
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link key={item.href} href={item.href} className={active ? styles.active : ""}>
                <span className={styles.step}>{item.step}</span>
                <span><b>{item.label}</b><small>{item.description}</small></span>
              </Link>
            );
          })}
        </nav>
        <Link href="/account" className={`${styles.accountLink} ${isActive(pathname, "/account") ? styles.accountLinkActive : ""}`}>
          <span>◉</span>
          <span><b>Account</b><small>Sign in and connect accounts</small></span>
        </Link>
        <div className={styles.sidebarNote}><b>Testnet mode</b><span>Robinhood Chain · 46630</span></div>
      </aside>

      <header className={styles.mobileHeader}>
        <Link href="/" className={styles.mobileBrand} aria-label="HOODLUMS home">
          <img src={HOODLUMS_WORDMARK_IMAGE} alt="HOODLUMS" width={1200} height={438} />
        </Link>
        <Link href="/account" className={styles.accountButton} aria-label="Open account">
          Account
        </Link>
      </header>
    </>
  );
}

export function MobileBottomNavigation() {
  const pathname = usePathname();

  return (
    <nav className={styles.bottomNav} aria-label="Mobile launch workflow">
      {NAV_ITEMS.map((item) => (
        <Link key={item.href} href={item.href} aria-label={item.label} title={item.label} className={isActive(pathname, item.href) ? styles.active : ""}>
          <NavIcon name={item.icon} />
        </Link>
      ))}
    </nav>
  );
}
