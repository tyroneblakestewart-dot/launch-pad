"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef, useState } from "react";
import styles from "./app-navigation.module.css";

const NAV_ITEMS = [
  { href: "/", label: "Studio", short: "Studio", step: "1", description: "Create or open a token" },
  { href: "/providers", label: "Providers", short: "Wallet", step: "2", description: "Choose the launch provider" },
  { href: "/allocations", label: "Allocations", short: "Allocate", step: "3", description: "Plan token distribution" },
  { href: "/liquidity-lab", label: "Liquidity Lab", short: "Liquidity", step: "4", description: "Test the token pool" },
] as const;

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href);
}

export function AppNavigation() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const dockRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const viewport = window.visualViewport;
    const dock = dockRef.current;
    if (!dock) return;

    let frame = 0;
    const timers: number[] = [];

    const measure = () => {
      const visibleHeight = viewport?.height ?? window.innerHeight;
      const visibleTop = viewport?.offsetTop ?? 0;
      const layoutHeight = Math.max(window.innerHeight, document.documentElement.clientHeight);
      const browserBottom = Math.max(0, layoutHeight - visibleHeight - visibleTop);

      dock.style.setProperty("--browser-bottom", `${Math.round(browserBottom)}px`);
      dock.dataset.ready = "true";
    };

    const scheduleMeasure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };

    // Measure synchronously before React yields, then repeat while Safari settles
    // its restored toolbar state after a refresh or back/forward navigation.
    measure();
    frame = requestAnimationFrame(measure);
    timers.push(window.setTimeout(measure, 60));
    timers.push(window.setTimeout(measure, 180));
    timers.push(window.setTimeout(measure, 400));

    viewport?.addEventListener("resize", scheduleMeasure);
    viewport?.addEventListener("scroll", scheduleMeasure);
    window.addEventListener("resize", scheduleMeasure);
    window.addEventListener("pageshow", scheduleMeasure);
    window.addEventListener("orientationchange", scheduleMeasure);

    return () => {
      cancelAnimationFrame(frame);
      timers.forEach((timer) => window.clearTimeout(timer));
      viewport?.removeEventListener("resize", scheduleMeasure);
      viewport?.removeEventListener("scroll", scheduleMeasure);
      window.removeEventListener("resize", scheduleMeasure);
      window.removeEventListener("pageshow", scheduleMeasure);
      window.removeEventListener("orientationchange", scheduleMeasure);
    };
  }, []);

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
        <div className={styles.sidebarNote}><b>Testnet mode</b><span>Robinhood Chain · 46630</span></div>
      </aside>

      <header className={styles.mobileHeader}>
        <Link href="/" className={styles.mobileBrand}>HOODLUMS</Link>
        <button onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label="Open navigation menu">{open ? "Close" : "Menu"}</button>
      </header>

      {open && (
        <div className={styles.mobileMenu}>
          {NAV_ITEMS.map((item) => (
            <Link key={item.href} href={item.href} className={isActive(pathname, item.href) ? styles.active : ""} onClick={() => setOpen(false)}>
              <span className={styles.step}>{item.step}</span>
              <span><b>{item.label}</b><small>{item.description}</small></span>
            </Link>
          ))}
        </div>
      )}

      <div ref={dockRef} className={styles.bottomDock}>
        <nav className={styles.bottomNav} aria-label="Mobile launch workflow">
          {NAV_ITEMS.map((item) => (
            <Link key={item.href} href={item.href} className={isActive(pathname, item.href) ? styles.active : ""}>
              <span>{item.step}</span><b>{item.short}</b>
            </Link>
          ))}
        </nav>
      </div>
    </>
  );
}
