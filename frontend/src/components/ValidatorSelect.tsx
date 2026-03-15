"use client";

import { useState, useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ValidatorStatus = "active" | "jailing" | "inactive";

export interface Validator {
  address: string;
  moniker: string;
  commission: string;
  votingPower?: string;
  status: ValidatorStatus;
}

interface ValidatorSelectProps {
  validators: Validator[];
  value: string | null;
  onChange: (address: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

// ─── Status dot ──────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<ValidatorStatus, string> = {
  active: "bg-emerald-400 shadow-[0_0_0_3px_rgba(52,211,153,0.15)]",
  jailing: "bg-yellow-400",
  inactive: "bg-neutral-500",
};

function StatusDot({ status }: { status: ValidatorStatus }) {
  return (
    <span
      className={`inline-block w-[7px] h-[7px] rounded-full flex-shrink-0 ${STATUS_COLORS[status]}`}
    />
  );
}

// ─── Check icon ──────────────────────────────────────────────────────────────

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      className="w-[14px] h-[14px] flex-shrink-0"
    >
      <path d="M2.5 7l3 3 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Chevron icon ─────────────────────────────────────────────────────────────

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <motion.svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      className="w-[16px] h-[16px] flex-shrink-0 text-[var(--text-muted)]"
      animate={{ rotate: open ? 180 : 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
    >
      <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </motion.svg>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ValidatorSelect({
  validators,
  value,
  onChange,
  disabled = false,
  placeholder = "Select validator",
}: ValidatorSelectProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const safeValidators = validators ?? [];
  const selected = safeValidators.find((v) => v.address === value) ?? null;

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, []);

  function handleSelect(address: string) {
    onChange(address);
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative w-full">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={[
          "input-field w-full text-sm py-2 flex items-center gap-2 text-left",
          "transition-[border-color,box-shadow] duration-200",
          open
            ? "border-[var(--border-bright)] shadow-[0_0_0_2px_rgba(255,255,255,0.07)]"
            : "",
          disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer",
        ].join(" ")}
      >
        {selected && <StatusDot status={selected.status} />}
        <span className={`flex-1 truncate ${selected ? "text-[var(--text-primary)]" : "text-[var(--text-muted)]"}`}>
          {selected ? selected.moniker : placeholder}
        </span>
        {selected && (
          <span className="text-[10px] text-[var(--text-muted)] bg-[var(--bg-secondary,rgba(255,255,255,0.06))] px-1.5 py-0.5 rounded-md font-mono flex-shrink-0">
            {selected.commission}
          </span>
        )}
        <ChevronIcon open={open} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="listbox"
            initial={{ opacity: 0, y: -6, scaleY: 0.96 }}
            animate={{ opacity: 1, y: 0, scaleY: 1 }}
            exit={{ opacity: 0, y: -4, scaleY: 0.97 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            style={{ originY: "top" }}
            className={[
              "absolute z-50 left-0 right-0 mt-1",
              "bg-[var(--bg-primary)] border border-[var(--border-subtle)]",
              "rounded-[10px] overflow-hidden",
              "shadow-[0_8px_32px_rgba(0,0,0,0.25)]",
            ].join(" ")}
          >
            <div className="p-1 flex flex-col gap-[1px]">
              {safeValidators.map((v, i) => {
                const isSelected = v.address === value;
                return (
                  <motion.button
                    key={v.address}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      duration: 0.2,
                      delay: i * 0.04,
                      ease: [0.16, 1, 0.3, 1],
                    }}
                    onClick={() => handleSelect(v.address)}
                    className={[
                      "w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg",
                      "text-left font-mono text-xs",
                      "transition-colors duration-100 cursor-pointer",
                      "border",
                      isSelected
                        ? "border-[var(--border-subtle)] bg-[var(--bg-secondary,rgba(255,255,255,0.05))]"
                        : "border-transparent hover:bg-[var(--bg-secondary,rgba(255,255,255,0.04))]",
                    ].join(" ")}
                  >
                    <StatusDot status={v.status} />
                    <span className="flex-1 font-medium text-[var(--text-primary)] truncate">
                      {v.moniker}
                    </span>
                    {v.votingPower && (
                      <span className="text-[10px] text-[var(--text-muted)] flex-shrink-0">
                        {v.votingPower}
                      </span>
                    )}
                    <span
                      className={[
                        "text-[10px] flex-shrink-0 px-1.5 py-0.5 rounded-md",
                        "bg-[var(--bg-secondary,rgba(255,255,255,0.06))]",
                        "text-[var(--text-muted)]",
                      ].join(" ")}
                    >
                      {v.commission}
                    </span>
                    <motion.span
                      animate={{ opacity: isSelected ? 1 : 0, scale: isSelected ? 1 : 0.6 }}
                      transition={{ duration: 0.15 }}
                      className="text-[var(--text-primary)] flex-shrink-0"
                    >
                      <CheckIcon />
                    </motion.span>
                  </motion.button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
