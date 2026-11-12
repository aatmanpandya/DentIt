"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Search } from "lucide-react";
import { listPatients } from "@/lib/patients-api";

/**
 * Top-bar patient search: name, phone or patient number, through the same GET /patients?q=
 * the Patients page uses. "/" focuses it from anywhere (unless you're already typing in a
 * field); arrows move, Enter opens, Esc closes. Before this it was an input wired to nothing.
 */
export function GlobalSearch() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 150);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      e.preventDefault();
      inputRef.current?.focus();
      setOpen(true);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const { data, isFetching } = useQuery({
    queryKey: ["global-search", debounced],
    queryFn: () => listPatients({ q: debounced, limit: 8 }),
    enabled: debounced.length >= 2,
  });
  const results = debounced.length >= 2 ? (data?.data ?? []) : [];

  function go(id: string) {
    setOpen(false);
    setQ("");
    inputRef.current?.blur();
    router.push(`/patients/${id}`);
  }

  return (
    <div className="relative mx-auto max-w-md flex-1">
      <div className="flex items-center gap-2 rounded-[var(--radius)] border border-rule bg-paper px-2.5 py-1.5 text-ink-soft focus-within:border-steel">
        <Search size={14} />
        <input
          ref={inputRef}
          type="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)} // let a click on a result land first
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter" && results[active]) {
              e.preventDefault();
              go(results[active].id);
            } else if (e.key === "Escape") {
              setOpen(false);
              inputRef.current?.blur();
            }
          }}
          placeholder="Search patients by name, phone or number…"
          aria-label="Search patients"
          role="combobox"
          aria-expanded={open && results.length > 0}
          aria-controls="global-search-results"
          className="w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-soft"
        />
        <kbd className="font-data rounded-[2px] border border-rule px-1 text-[10px] text-ink-soft">/</kbd>
      </div>

      {open && debounced.length >= 2 && (
        <ul
          id="global-search-results"
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-[var(--radius)] border border-rule bg-surface shadow-lg"
        >
          {results.length === 0 ? (
            <li className="px-3 py-2 text-[12px] text-ink-soft">{isFetching ? "Searching…" : `No patients match "${debounced}".`}</li>
          ) : (
            results.map((p, i) => (
              <li key={p.id} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => go(p.id)}
                  onMouseEnter={() => setActive(i)}
                  className={clsx("flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-[13px]", i === active && "bg-steel-lo")}
                >
                  <span className="text-ink">
                    {p.first_name} {p.last_name}
                  </span>
                  <span className="font-data text-[11px] text-ink-soft">
                    {p.patient_number} · {p.phone}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
