"use client";

import { useEffect, useState } from "react";
import { Icon } from "../../ui/Icon";

export function ThemeToggle() {
  const [dark, setDark] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem("pa-theme");
    const isDark = stored ? stored === "dark" : true;
    setDark(isDark);
    document.documentElement.classList.toggle("dark", isDark);
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("pa-theme", next ? "dark" : "light");
  };

  return (
    <button className="side-nav__theme" onClick={toggle} aria-label="Toggle color theme">
      <Icon name={dark ? "sun" : "moon"} size={15} stroke={2} />
      <span>{dark ? "Light" : "Dark"} mode</span>
    </button>
  );
}
