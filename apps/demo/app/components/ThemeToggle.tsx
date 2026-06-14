"use client";

import { useEffect, useState } from "react";
import { Icon } from "../../ui/Icon";

const STORAGE_KEY = "reineira-theme";

export function ThemeToggle() {
  const [dark, setDark] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    const isDark =
      stored === "dark" || stored === "light"
        ? stored === "dark"
        : window.matchMedia("(prefers-color-scheme: dark)").matches;
    setDark(isDark);
    document.documentElement.classList.toggle("dark", isDark);
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem(STORAGE_KEY, next ? "dark" : "light");
  };

  return (
    <button className="side-nav__theme" onClick={toggle} aria-label="Toggle color theme">
      <Icon name={dark ? "sun" : "moon"} size={15} stroke={2} />
      <span>{dark ? "Light" : "Dark"} mode</span>
    </button>
  );
}
