import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import styles from "./Browse.module.css";
import {
  type BrowseFilters,
  type BrowseSort,
  FACET_LABELS,
  FACETS,
  type FacetKey,
  type Facets,
  facetValueLabel,
} from "./browse.ts";

const SEARCHABLE_OVER = 8;

function FacetMenu({
  facet,
  options,
  selected,
  onChange,
}: {
  facet: FacetKey;
  options: { value: string; count: number }[];
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [find, setFind] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const label = FACET_LABELS[facet];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const known = new Set(options.map((o) => o.value));
  const all = [...options, ...selected.filter((v) => !known.has(v)).map((value) => ({ value, count: 0 }))];
  const needle = find.trim().toLowerCase();
  const shown = needle
    ? all.filter((o) => facetValueLabel(facet, o.value).toLowerCase().includes(needle))
    : all;
  const toggle = (value: string) =>
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);

  let summary = label;
  const [first] = selected;
  if (first) summary += ` · ${selected.length === 1 ? facetValueLabel(facet, first) : selected.length}`;

  return (
    <div className={styles.facet} ref={ref}>
      <button
        type="button"
        className={styles.facetBtn}
        data-active={selected.length > 0 || undefined}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={styles.facetText}>{summary}</span>
        <ChevronDown size={14} strokeWidth={1.6} aria-hidden="true" />
      </button>
      {open && (
        <fieldset className={styles.menu}>
          <legend className="sr-only">按{label}筛选</legend>
          {all.length > SEARCHABLE_OVER && (
            <input
              type="search"
              className={styles.menuFind}
              placeholder={`搜索${label}`}
              aria-label={`搜索${label}`}
              value={find}
              onChange={(e) => setFind(e.target.value)}
            />
          )}
          <ul className={styles.options}>
            {shown.map((o) => (
              <li key={o.value}>
                <label className={styles.option}>
                  <input
                    type="checkbox"
                    checked={selected.includes(o.value)}
                    onChange={() => toggle(o.value)}
                  />
                  <span className={styles.optLabel}>{facetValueLabel(facet, o.value)}</span>
                  <span className={styles.optCount}>{o.count}</span>
                </label>
              </li>
            ))}
            {shown.length === 0 && <li className={styles.optEmpty}>没有可选项</li>}
          </ul>
          {selected.length > 0 && (
            <button type="button" className={styles.menuClear} onClick={() => onChange([])}>
              清除{label}
            </button>
          )}
        </fieldset>
      )}
    </div>
  );
}

export function BrowseFilterBar({
  filters,
  facets,
  sort,
  onFilter,
  onSort,
  onClear,
}: {
  filters: BrowseFilters;
  facets: Facets | undefined;
  sort: BrowseSort;
  onFilter: (key: FacetKey, values: string[]) => void;
  onSort: (sort: BrowseSort) => void;
  onClear: () => void;
}) {
  const active = FACETS.some((k) => filters[k].length > 0);
  return (
    <div className={styles.filters}>
      {FACETS.map((k) => (
        <FacetMenu
          key={k}
          facet={k}
          options={facets?.[k] ?? []}
          selected={filters[k]}
          onChange={(v) => onFilter(k, v)}
        />
      ))}
      {active && (
        <button type="button" className={styles.clearAll} onClick={onClear}>
          清除筛选
        </button>
      )}
      <label className={styles.sort}>
        <span className="sr-only">排序</span>
        <select value={sort} onChange={(e) => onSort(e.target.value as BrowseSort)}>
          <option value="latest">最新发布</option>
          <option value="match">和我匹配度</option>
        </select>
      </label>
    </div>
  );
}
