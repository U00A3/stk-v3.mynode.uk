"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";

const STORAGE_KEY = "shared-node-staking-theme";

export type Theme = "dark" | "light";

export function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "light" || attr === "dark") return attr;
  const stored = window.localStorage.getItem(STORAGE_KEY) as Theme | null;
  if (stored === "light" || stored === "dark") return stored;
  return "light";
}

export function setTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  window.localStorage.setItem(STORAGE_KEY, theme);
}

export default function ThemeToggle() {
  const [theme, setThemeState] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const t = getInitialTheme();
    document.documentElement.setAttribute("data-theme", t);
    setThemeState(t);
  }, []);

  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    setThemeState(next);
  };

  if (!mounted) {
    return (
      <div
        className="w-10 h-6 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-card)]"
        aria-hidden
      />
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="flex items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-card)] p-1 w-10 h-6 transition-colors hover:border-[var(--border-medium)] focus:outline-none focus:ring-2 focus:ring-[var(--border-bright)] focus:ring-offset-2 focus:ring-offset-[var(--bg-primary)]"
      aria-label={theme === "dark" ? "Przełącz na jasny motyw" : "Przełącz na ciemny motyw"}
      title={theme === "dark" ? "Jasny motyw" : "Ciemny motyw"}
    >
      <motion.span
        className="block w-4 h-4 rounded-full bg-[var(--border-medium)]"
        animate={{ x: theme === "light" ? 18 : 2 }}
        transition={{ type: "spring", stiffness: 400, damping: 28 }}
      />
    </button>
  );
}
