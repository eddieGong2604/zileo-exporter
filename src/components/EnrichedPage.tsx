import { useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import { fetchEnrichedContacts } from "../api/enrichedContacts";
import type { EnrichedContact } from "../types/enriched";

type ColumnDef = {
  key: string;
  label: string;
  getValue: (row: EnrichedContact) => unknown;
};
type SortDirection = "asc" | "desc";
type SortState = { key: string; direction: SortDirection } | null;
type CompanyStatusFilter = "all" | "approved" | "queued" | "rejected";

const SOURCE_COUNTRY_OPTIONS = [
  "Australia",
  "United States",
  "United Kingdom",
] as const;

const DEFAULT_SOURCE_COUNTRY_SELECTION = new Set<string>(["Australia"]);

const DEFAULT_VISIBLE_COLUMN_KEYS = new Set<string>([
  "company.source_company_name",
  "company.company_description",
  "company.source_latest_job_posted_at",
  "company.status",
  "company.rejection_reason",
  "contact.contact_name",
  "contact.contact_linkedin",
  "contact.contact_location",
  "contact.predicted_origin_of_name",
  "contact.is_predicted_origin_blacklisted",
  "contact.is_contact_location_blacklisted",
]);

const CONTACT_COLUMN_DEFS: ColumnDef[] = [
  { key: "contact.id", label: "Contact Id", getValue: (row) => row.id },
  { key: "contact.company_id", label: "Contact Company Id", getValue: (row) => row.companyId },
  { key: "contact.contact_name", label: "Contact Name", getValue: (row) => row.contactName },
  {
    key: "contact.contact_linkedin",
    label: "Contact Linkedin",
    getValue: (row) => row.contactLinkedin,
  },
  {
    key: "contact.apollo_profile_href",
    label: "Apollo Profile Href",
    getValue: (row) => row.apolloProfileHref,
  },
  {
    key: "contact.contact_location",
    label: "Contact Location",
    getValue: (row) => row.contactLocation,
  },
  {
    key: "contact.predicted_origin_of_name",
    label: "Predicted Origin",
    getValue: (row) => row.predictedOriginOfName,
  },
  {
    key: "contact.country_id",
    label: "Country Id",
    getValue: (row) => row.countryId,
  },
  {
    key: "contact.is_predicted_origin_blacklisted",
    label: "Origin Blacklisted",
    getValue: (row) => row.isPredictedOriginBlacklisted,
  },
  {
    key: "contact.is_contact_location_blacklisted",
    label: "Location Blacklisted",
    getValue: (row) => row.isContactLocationBlacklisted,
  },
  { key: "contact.source", label: "Contact Source", getValue: (row) => row.source },
  { key: "contact.email", label: "Contact Email", getValue: (row) => row.email },
  { key: "contact.created_at", label: "Contact Created At", getValue: (row) => row.createdAt },
  { key: "contact.updated_at", label: "Contact Updated At", getValue: (row) => row.updatedAt },
];

function isDateLikeColumnKey(columnKey: string): boolean {
  return (
    columnKey.endsWith("_at") ||
    columnKey.endsWith(".createdAt") ||
    columnKey.endsWith(".updatedAt")
  );
}

function displayValue(value: unknown, columnKey?: string): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") {
    const normalized = value.trim();
    if (!normalized) return "—";
    if (columnKey && isDateLikeColumnKey(columnKey)) {
      const parsed = dayjs(normalized);
      if (parsed.isValid()) {
        return parsed.format("DD MMM YYYY, HH:mm:ss");
      }
    }
    return normalized;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function companyNameFromRecord(company: Record<string, unknown> | null): string {
  if (!company) return "Unknown company";
  const raw = company.source_company_name;
  if (typeof raw !== "string") return "Unknown company";
  const name = raw.trim();
  return name || "Unknown company";
}

function companyLabel(item: EnrichedContact): string {
  return companyNameFromRecord(item.company);
}

function formatFieldName(input: string): string {
  return input
    .split("_")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function companyColumns(rows: EnrichedContact[]): ColumnDef[] {
  const keySet = new Set<string>();
  for (const row of rows) {
    if (!row.company) continue;
    for (const key of Object.keys(row.company)) keySet.add(key);
  }
  return Array.from(keySet)
    .sort((a, b) => a.localeCompare(b))
    .map((key) => ({
      key: `company.${key}`,
      label: `Company ${formatFieldName(key)}`,
      getValue: (row) => row.company?.[key],
    }));
}

function allColumns(rows: EnrichedContact[]): ColumnDef[] {
  return [...companyColumns(rows), ...CONTACT_COLUMN_DEFS];
}

function sortColumnsByVisibility(
  columns: ColumnDef[],
  visibleColumnKeys: Set<string>,
): ColumnDef[] {
  return columns.filter((column) => visibleColumnKeys.has(column.key));
}

function compareValues(a: unknown, b: unknown, columnKey: string): number {
  const normalize = (value: unknown): string | number | null => {
    if (value === null || value === undefined) return null;
    if (typeof value === "number") return value;
    if (typeof value === "boolean") return value ? 1 : 0;
    if (typeof value === "string") {
      const text = value.trim();
      if (!text) return null;
      if (isDateLikeColumnKey(columnKey)) {
        const parsed = dayjs(text);
        if (parsed.isValid()) return parsed.valueOf();
      }
      return text.toLowerCase();
    }
    return JSON.stringify(value).toLowerCase();
  };

  const left = normalize(a);
  const right = normalize(b);
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;

  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left).localeCompare(String(right));
}

function buildRowKey(row: EnrichedContact, index: number): string {
  const companyId = row.company?.id ?? row.companyId ?? "no-company";
  const contactId = row.id ?? "no-contact";
  return `${companyId}-${contactId}-${index}`;
}

function isTruthyBlacklistFlag(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    return s === "true" || s === "t" || s === "1" || s === "yes";
  }
  return false;
}

function normalizeSourceCountry(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** True when DB `source_country` matches one of the canonical options (with common aliases). */
function sourceCountryMatchesOption(dbValue: string, option: string): boolean {
  const n = normalizeSourceCountry(dbValue);
  if (normalizeSourceCountry(option) === n) return true;
  if (option === "Australia") {
    return n === "au" || n === "aus";
  }
  if (option === "United States") {
    return (
      n === "usa" ||
      n === "us" ||
      n === "u.s." ||
      n === "u.s.a." ||
      n === "united states of america"
    );
  }
  if (option === "United Kingdom") {
    return n === "uk" || n === "gb" || n === "great britain";
  }
  return false;
}

function rowMatchesSourceCountryFilter(
  row: EnrichedContact,
  selected: ReadonlySet<string>,
): boolean {
  if (selected.size === 0) return true;
  const raw = row.company?.source_country;
  if (typeof raw !== "string" || !raw.trim()) return false;
  for (const opt of selected) {
    if (sourceCountryMatchesOption(raw, opt)) return true;
  }
  return false;
}

function filterSummary(
  status: CompanyStatusFilter,
  excludeOriginBlacklist: boolean,
  excludeLocationBlacklist: boolean,
  sourceCountries: ReadonlySet<string>,
): string {
  const statusPart =
    status === "all" ? "All statuses" : `${status[0]!.toUpperCase()}${status.slice(1)}`;
  const parts = [statusPart];
  parts.push(
    excludeOriginBlacklist ? "Origin not blacklisted" : "Any origin blacklist",
  );
  parts.push(
    excludeLocationBlacklist ? "Location not blacklisted" : "Any location blacklist",
  );
  if (sourceCountries.size === 0) {
    parts.push("All source countries");
  } else {
    parts.push(
      `Source country: ${[...sourceCountries].sort((a, b) => a.localeCompare(b)).join(", ")}`,
    );
  }
  return parts.join(" · ");
}

export function EnrichedPage() {
  const [rows, setRows] = useState<EnrichedContact[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groupByCompany, setGroupByCompany] = useState(true);
  const [visibleColumnKeys, setVisibleColumnKeys] = useState<Set<string>>(new Set());
  const [sortState, setSortState] = useState<SortState>(null);
  const [columnConfigOpen, setColumnConfigOpen] = useState(false);
  const [initializedVisibleColumns, setInitializedVisibleColumns] = useState(false);
  const [statusFilter, setStatusFilter] = useState<CompanyStatusFilter>("approved");
  const [excludePredictedOriginBlacklist, setExcludePredictedOriginBlacklist] = useState(true);
  const [excludeContactLocationBlacklist, setExcludeContactLocationBlacklist] = useState(true);
  const [sourceCountrySelection, setSourceCountrySelection] = useState<Set<string>>(
    () => new Set(DEFAULT_SOURCE_COUNTRY_SELECTION),
  );
  const [filterModalOpen, setFilterModalOpen] = useState(false);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchEnrichedContacts();
        setRows(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load data");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const columns = useMemo(() => allColumns(rows), [rows]);

  useEffect(() => {
    if (!columns.length) return;

    if (!initializedVisibleColumns) {
      const hasCompanyColumns = columns.some((column) => column.key.startsWith("company."));
      if (!hasCompanyColumns && rows.length === 0) return;
      const defaults = columns
        .map((column) => column.key)
        .filter((key) => DEFAULT_VISIBLE_COLUMN_KEYS.has(key));
      setVisibleColumnKeys(
        new Set(defaults.length > 0 ? defaults : columns.map((column) => column.key)),
      );
      setInitializedVisibleColumns(true);
      return;
    }

    setVisibleColumnKeys((prev) => {
      const columnKeys = new Set(columns.map((column) => column.key));
      return new Set(Array.from(prev).filter((key) => columnKeys.has(key)));
    });
  }, [columns, initializedVisibleColumns, rows.length]);

  const visibleColumns = useMemo(
    () => sortColumnsByVisibility(columns, visibleColumnKeys),
    [columns, visibleColumnKeys],
  );

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      if (statusFilter !== "all") {
        const raw = row.company?.status;
        if (typeof raw !== "string" || raw.trim().toLowerCase() !== statusFilter) {
          return false;
        }
      }
      if (
        excludePredictedOriginBlacklist &&
        isTruthyBlacklistFlag(row.isPredictedOriginBlacklisted)
      ) {
        return false;
      }
      if (
        excludeContactLocationBlacklist &&
        isTruthyBlacklistFlag(row.isContactLocationBlacklisted)
      ) {
        return false;
      }
      if (!rowMatchesSourceCountryFilter(row, sourceCountrySelection)) {
        return false;
      }
      return true;
    });
  }, [
    rows,
    statusFilter,
    excludePredictedOriginBlacklist,
    excludeContactLocationBlacklist,
    sourceCountrySelection,
  ]);

  const sortedRows = useMemo(() => {
    if (!sortState) return filteredRows;
    const active = columns.find((column) => column.key === sortState.key);
    if (!active) return filteredRows;
    const sorted = [...filteredRows].sort((leftRow, rightRow) => {
      const compared = compareValues(
        active.getValue(leftRow),
        active.getValue(rightRow),
        active.key,
      );
      return sortState.direction === "asc" ? compared : -compared;
    });
    return sorted;
  }, [columns, filteredRows, sortState]);

  const grouped = useMemo(() => {
    if (!groupByCompany) return [];
    const map = new Map<string, EnrichedContact[]>();
    for (const row of sortedRows) {
      const key = companyLabel(row);
      const bucket = map.get(key);
      if (bucket) {
        bucket.push(row);
      } else {
        map.set(key, [row]);
      }
    }
    return Array.from(map.entries()).map(([company, contacts]) => ({
      company,
      contacts,
    }));
  }, [groupByCompany, sortedRows]);

  const toggleSort = (columnKey: string) => {
    setSortState((prev) => {
      if (!prev || prev.key !== columnKey) return { key: columnKey, direction: "asc" };
      if (prev.direction === "asc") return { key: columnKey, direction: "desc" };
      return null;
    });
  };

  return (
    <div className="app app--wide app--dense">
      <header className="header">
        <h1>Enriched Contacts</h1>
        <p className="subtitle">All contacts with their linked company record</p>
      </header>

      <section className="panel">
        <div className="route-links">
          <a href="/">Search</a>
          <a href="/enriched" aria-current="page">
            Enriched
          </a>
        </div>
        <div className="actions">
          <label className="toggle-line">
            <input
              type="checkbox"
              checked={groupByCompany}
              onChange={(e) => setGroupByCompany(e.target.checked)}
            />
            <span>Group by company</span>
          </label>
          <button
            type="button"
            className="column-btn filter-trigger-btn"
            onClick={() => setFilterModalOpen(true)}
          >
            Filters
            <span className="filter-trigger-summary">
              {filterSummary(
                statusFilter,
                excludePredictedOriginBlacklist,
                excludeContactLocationBlacklist,
                sourceCountrySelection,
              )}
            </span>
          </button>
          <button
            type="button"
            className="column-btn"
            onClick={() => setColumnConfigOpen(true)}
          >
            Configure columns
          </button>
        </div>
      </section>

      {loading && <div className="meta-bar">Loading enriched contacts...</div>}
      {error && <div className="error">{error}</div>}

      {!loading && !error && !groupByCompany && (
        <section className="results">
          <div className="meta-bar meta-bar-row">
            <span>
              {sortedRows.length} contacts
              <span className="meta-filter-hint">
                {" "}
                ·{" "}
                {filterSummary(
                  statusFilter,
                  excludePredictedOriginBlacklist,
                  excludeContactLocationBlacklist,
                  sourceCountrySelection,
                )}
              </span>
            </span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {visibleColumns.map((column) => (
                    <th key={column.key}>
                      <button
                        type="button"
                        className="th-sort-btn"
                        onClick={() => toggleSort(column.key)}
                      >
                        {column.label}
                        {sortState?.key === column.key ? (
                          <span>{sortState.direction === "asc" ? " ↑" : " ↓"}</span>
                        ) : (
                          <span className="sort-hint"> ↕</span>
                        )}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row, idx) => (
                  <tr key={buildRowKey(row, idx)}>
                    {visibleColumns.map((column) => (
                      <td key={`${buildRowKey(row, idx)}-${column.key}`}>
                        {displayValue(column.getValue(row), column.key)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {filterModalOpen && (
        <div className="modal-backdrop" onClick={() => setFilterModalOpen(false)}>
          <div className="modal filter-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Filters</h2>
              <button
                type="button"
                className="modal-close"
                onClick={() => setFilterModalOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="filter-modal-body">
              <fieldset className="filter-fieldset">
                <legend>Company status</legend>
                <div className="filter-radio-list">
                  {(
                    [
                      ["all", "All"],
                      ["approved", "Approved"],
                      ["queued", "Queued"],
                      ["rejected", "Rejected"],
                    ] as const
                  ).map(([value, label]) => (
                    <label key={value} className="filter-radio-row">
                      <input
                        type="radio"
                        name="company-status-filter"
                        value={value}
                        checked={statusFilter === value}
                        onChange={() => setStatusFilter(value)}
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset className="filter-fieldset">
                <legend>Company source country</legend>
                <p className="filter-fieldset-hint">
                  Choose one or more. Leave all unchecked to include every country.
                </p>
                <div className="filter-checkbox-stack">
                  {SOURCE_COUNTRY_OPTIONS.map((country) => (
                    <label key={country} className="filter-checkbox-row">
                      <input
                        type="checkbox"
                        checked={sourceCountrySelection.has(country)}
                        onChange={() => {
                          setSourceCountrySelection((prev) => {
                            const next = new Set(prev);
                            if (next.has(country)) next.delete(country);
                            else next.add(country);
                            return next;
                          });
                        }}
                      />
                      <span>{country}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="filter-checkbox-row">
                <input
                  type="checkbox"
                  checked={excludePredictedOriginBlacklist}
                  onChange={(e) => setExcludePredictedOriginBlacklist(e.target.checked)}
                />
                <span>
                  Hide origin-blacklisted leads{" "}
                  <span className="filter-checkbox-hint">
                    (predicted origin blacklist is null or false)
                  </span>
                </span>
              </label>
              <label className="filter-checkbox-row">
                <input
                  type="checkbox"
                  checked={excludeContactLocationBlacklist}
                  onChange={(e) => setExcludeContactLocationBlacklist(e.target.checked)}
                />
                <span>
                  Hide location-blacklisted leads{" "}
                  <span className="filter-checkbox-hint">
                    (contact in blacklisted country for location — null or false passes)
                  </span>
                </span>
              </label>
            </div>
            <div className="modal-foot filter-modal-foot">
              <button
                type="button"
                className="column-btn"
                onClick={() => {
                  setStatusFilter("approved");
                  setExcludePredictedOriginBlacklist(true);
                  setExcludeContactLocationBlacklist(true);
                  setSourceCountrySelection(new Set(DEFAULT_SOURCE_COUNTRY_SELECTION));
                }}
              >
                Reset to defaults
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => setFilterModalOpen(false)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {columnConfigOpen && (
        <div className="modal-backdrop" onClick={() => setColumnConfigOpen(false)}>
          <div className="modal column-config-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Configure columns</h2>
              <button
                type="button"
                className="modal-close"
                onClick={() => setColumnConfigOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="dm-results">
              <div className="column-picker-top">
                <button
                  type="button"
                  className="column-btn"
                  onClick={() => setVisibleColumnKeys(new Set(columns.map((col) => col.key)))}
                >
                  Show all
                </button>
                <button
                  type="button"
                  className="column-btn"
                  onClick={() => {
                    const defaults = columns
                      .map((column) => column.key)
                      .filter((key) => DEFAULT_VISIBLE_COLUMN_KEYS.has(key));
                    setVisibleColumnKeys(
                      new Set(
                        defaults.length > 0 ? defaults : columns.map((column) => column.key),
                      ),
                    );
                  }}
                >
                  Reset default
                </button>
              </div>
              <div className="column-picker-list">
                {columns.map((column) => (
                  <label key={column.key} className="column-toggle-item">
                    <input
                      type="checkbox"
                      checked={visibleColumnKeys.has(column.key)}
                      onChange={(e) => {
                        setVisibleColumnKeys((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(column.key);
                          else next.delete(column.key);
                          return next;
                        });
                      }}
                    />
                    <span>{column.label}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="modal-foot">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setColumnConfigOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {!loading && !error && groupByCompany && (
        <div className="grouped-wrap">
          {grouped.map((item) => (
            <section className="results group-card" key={item.company}>
              <div className="meta-bar">
                {item.company} ({item.contacts.length})
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      {visibleColumns.map((column) => (
                        <th key={column.key}>
                          <button
                            type="button"
                            className="th-sort-btn"
                            onClick={() => toggleSort(column.key)}
                          >
                            {column.label}
                            {sortState?.key === column.key ? (
                              <span>{sortState.direction === "asc" ? " ↑" : " ↓"}</span>
                            ) : (
                              <span className="sort-hint"> ↕</span>
                            )}
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {item.contacts.map((row, idx) => (
                      <tr key={buildRowKey(row, idx)}>
                        {visibleColumns.map((column) => (
                          <td key={`${buildRowKey(row, idx)}-${column.key}`}>
                            {displayValue(column.getValue(row), column.key)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
