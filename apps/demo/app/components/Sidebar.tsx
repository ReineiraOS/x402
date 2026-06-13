"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wordmark } from "../../ui/Wordmark";
import { Icon } from "../../ui/Icon";
import { ThemeToggle } from "./ThemeToggle";

type NavItem = { href: string; label: string; icon: string; match: (p: string) => boolean };

const NAV: NavItem[] = [
  { href: "/", label: "Agents", icon: "cube", match: (p) => p === "/" || p.startsWith("/agents") },
  { href: "/analytics", label: "Analytics", icon: "chart", match: (p) => p.startsWith("/analytics") },
  { href: "/plugins", label: "Plugins", icon: "plug", match: (p) => p.startsWith("/plugins") },
  { href: "/resources", label: "Resources", icon: "feed", match: (p) => p.startsWith("/resources") },
];

export function Sidebar({ onToggle }: { onToggle?: () => void }) {
  const pathname = usePathname();

  return (
    <aside className="side-nav">
      <div className="side-nav__inner thin-scroll">
        <div className="side-nav__head">
          <div className="side-nav__top">
            <Link href="/" className="side-nav__brand" aria-label="Payment Agents — home">
              <Wordmark size={26} />
            </Link>
            {onToggle ? (
              <button className="side-nav__collapse" onClick={onToggle} aria-label="Hide navigation" title="Hide navigation">
                <Icon name="panel" size={16} stroke={2} />
              </button>
            ) : null}
          </div>
          <span className="side-nav__app">
            Payment <span>Agents</span>
          </span>
        </div>

        <div className="side-nav__group">
          <span className="side-nav__cap">General</span>
          <nav className="side-nav__links">
            {NAV.map((item) => {
              const active = item.match(pathname);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`side-nav__link${active ? " side-nav__link--active" : ""}`}
                >
                  <Icon name={item.icon} size={16} stroke={2} />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="side-nav__group">
          <span className="side-nav__cap">Reference</span>
          <nav className="side-nav__links">
            <a className="side-nav__link" href="https://reineira.xyz/docs" target="_blank" rel="noreferrer">
              <Icon name="book" size={16} stroke={2} /> Docs <span className="side-nav__ext">↗</span>
            </a>
            <a className="side-nav__link" href="https://reineira.xyz/portal" target="_blank" rel="noreferrer">
              <Icon name="globe" size={16} stroke={2} /> Portal <span className="side-nav__ext">↗</span>
            </a>
          </nav>
        </div>

        <div className="side-nav__foot">
          <ThemeToggle />
          <span className="side-nav__net">
            <span className="side-nav__net-dot" aria-hidden /> Testnet · Arbitrum Sepolia
          </span>
          <a className="side-nav__social" href="https://t.me/reineira" target="_blank" rel="noreferrer">
            Telegram ↗
          </a>
        </div>
      </div>
    </aside>
  );
}
