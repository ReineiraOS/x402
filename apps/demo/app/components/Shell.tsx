"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { Icon } from "../../ui/Icon";

export function Shell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(localStorage.getItem("pa-nav") === "collapsed");
  }, []);

  const toggle = () => {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem("pa-nav", next ? "collapsed" : "open");
      return next;
    });
  };

  return (
    <div className={`shell${collapsed ? " shell--collapsed" : ""}`}>
      <Sidebar onToggle={toggle} />
      <main className="shell__main">
        {collapsed ? (
          <button
            className="shell__reveal"
            onClick={toggle}
            aria-label="Show navigation"
            title="Show navigation"
          >
            <Icon name="panel" size={16} stroke={2} />
          </button>
        ) : null}
        {children}
      </main>
    </div>
  );
}
