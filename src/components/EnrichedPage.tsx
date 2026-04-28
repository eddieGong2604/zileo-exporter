import { useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import { fetchEnrichedContacts } from "../api/enrichedContacts";
import { bulkSendMeetAlfred, fetchMeetAlfredCampaigns } from "../api/meetAlfred";
import type { EnrichedContact } from "../types/enriched";

type ColumnDef = {
  key: string;
  label: string;
  getValue: (row: EnrichedContact) => unknown;
};
type SortDirection = "asc" | "desc";
type SortState = { key: string; direction: SortDirection } | null;
type CompanyStatusFilter = "all" | "approved" | "queued" | "rejected";
type MeetAlfredCampaign = {
  id: number;
  label: string;
  status?: string;
  webhookKey: string;
};

const LS_KEYS = {
  groupByCompany: "enriched.groupByCompany",
  statusFilter: "enriched.statusFilter",
  excludeOriginBlacklist: "enriched.excludeOriginBlacklist",
  excludeLocationBlacklist: "enriched.excludeLocationBlacklist",
  sourceCountries: "enriched.sourceCountries",
  visibleColumns: "enriched.visibleColumns",
} as const;

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
  "contact.first_name",
  "contact.contact_name",
  "contact.title",
  "contact.contact_linkedin",
  "contact.contact_location",
  "contact.predicted_origin_of_name",
  "contact.is_predicted_origin_blacklisted",
  "contact.is_contact_location_blacklisted",
]);

const CONTACT_COLUMN_DEFS: ColumnDef[] = [
  { key: "contact.id", label: "Contact Id", getValue: (row) => row.id },
  { key: "contact.company_id", label: "Contact Company Id", getValue: (row) => row.companyId },
  { key: "contact.first_name", label: "First Name", getValue: (row) => row.firstName },
  { key: "contact.contact_name", label: "Contact Name", getValue: (row) => row.contactName },
  { key: "contact.title", label: "Title", getValue: (row) => row.title },
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

function selectionKeyForRow(row: EnrichedContact): string {
  const companyId = String(row.company?.id ?? row.companyId ?? "");
  const contactId = String(row.id ?? "");
  const linkedin = (row.contactLinkedin ?? "").trim().toLowerCase();
  const name = (row.contactName ?? "").trim().toLowerCase();
  return `${companyId}::${contactId}::${linkedin}::${name}`;
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
    return (
      n === "uk" ||
      n === "gb" ||
      n === "great britain" ||
      n === "united kingdon" ||
      n === "united kinadom" ||
      n === "united kindgom"
    );
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

function safeReadLocalStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeWriteLocalStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage failures (private mode/quota/etc).
  }
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function firstNameFromContactName(name: string | null): string {
  const normalized = (name ?? "").trim();
  if (!normalized) return "";
  return normalized.split(/\s+/)[0] ?? "";
}

function firstNameFromRow(row: EnrichedContact): string {
  const fromField = (row.firstName ?? "").trim();
  if (fromField) return fromField;
  return firstNameFromContactName(row.contactName);
}

function companyNameFromRow(row: EnrichedContact): string {
  const raw = row.company?.source_company_name;
  return typeof raw === "string" ? raw.trim() : "";
}

function companyCountryFromRow(row: EnrichedContact): string {
  const raw = row.company?.source_country;
  return typeof raw === "string" ? raw.trim() : "";
}

function exportRowsToCsv(rows: EnrichedContact[]): void {
  const headers = ["linkedin_url", "firstname", "companyname", "email", "country"];
  const lines = [headers.join(",")];
  for (const row of rows) {
    const values = [
      (row.contactLinkedin ?? "").trim(),
      firstNameFromRow(row),
      companyNameFromRow(row),
      (row.email ?? "").trim(),
      companyCountryFromRow(row),
    ].map(csvEscape);
    lines.push(values.join(","));
  }

  const csv = lines.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `enriched_contacts_${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function EnrichedPage() {
  const [rows, setRows] = useState<EnrichedContact[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groupByCompany, setGroupByCompany] = useState<boolean>(() => {
    const raw = safeReadLocalStorage(LS_KEYS.groupByCompany);
    if (raw === "false") return false;
    if (raw === "true") return true;
    return true;
  });
  const [visibleColumnKeys, setVisibleColumnKeys] = useState<Set<string>>(new Set());
  const [sortState, setSortState] = useState<SortState>(null);
  const [columnConfigOpen, setColumnConfigOpen] = useState(false);
  const [initializedVisibleColumns, setInitializedVisibleColumns] = useState(false);
  const [statusFilter, setStatusFilter] = useState<CompanyStatusFilter>(() => {
    const raw = safeReadLocalStorage(LS_KEYS.statusFilter);
    if (raw === "all" || raw === "approved" || raw === "queued" || raw === "rejected") {
      return raw;
    }
    return "approved";
  });
  const [excludePredictedOriginBlacklist, setExcludePredictedOriginBlacklist] = useState(() => {
    const raw = safeReadLocalStorage(LS_KEYS.excludeOriginBlacklist);
    if (raw === "false") return false;
    if (raw === "true") return true;
    return true;
  });
  const [excludeContactLocationBlacklist, setExcludeContactLocationBlacklist] = useState(() => {
    const raw = safeReadLocalStorage(LS_KEYS.excludeLocationBlacklist);
    if (raw === "false") return false;
    if (raw === "true") return true;
    return true;
  });
  const [sourceCountrySelection, setSourceCountrySelection] = useState<Set<string>>(
    () => {
      const raw = safeReadLocalStorage(LS_KEYS.sourceCountries);
      if (!raw) return new Set(DEFAULT_SOURCE_COUNTRY_SELECTION);
      try {
        const arr = JSON.parse(raw) as string[];
        if (!Array.isArray(arr)) return new Set(DEFAULT_SOURCE_COUNTRY_SELECTION);
        const normalized = arr.filter((v) =>
          SOURCE_COUNTRY_OPTIONS.includes(v as (typeof SOURCE_COUNTRY_OPTIONS)[number]),
        );
        return new Set(normalized);
      } catch {
        return new Set(DEFAULT_SOURCE_COUNTRY_SELECTION);
      }
    },
  );
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<Set<string>>(new Set());
  const [meetAlfredModalOpen, setMeetAlfredModalOpen] = useState(false);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [campaignsError, setCampaignsError] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<MeetAlfredCampaign[]>([]);
  const [selectedCampaignComposite, setSelectedCampaignComposite] = useState("");
  const [sendingToMeetAlfred, setSendingToMeetAlfred] = useState(false);
  const [sendResultMessage, setSendResultMessage] = useState<string | null>(null);

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
      const savedVisibleRaw = safeReadLocalStorage(LS_KEYS.visibleColumns);
      let defaults: string[] = [];
      if (savedVisibleRaw) {
        try {
          const saved = JSON.parse(savedVisibleRaw) as string[];
          if (Array.isArray(saved)) {
            const allowed = new Set(columns.map((c) => c.key));
            defaults = saved.filter((k) => allowed.has(k));
          }
        } catch {
          defaults = [];
        }
      }
      if (defaults.length === 0) {
        defaults = columns
          .map((column) => column.key)
          .filter((key) => DEFAULT_VISIBLE_COLUMN_KEYS.has(key));
      }
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

  useEffect(() => {
    safeWriteLocalStorage(LS_KEYS.groupByCompany, String(groupByCompany));
  }, [groupByCompany]);

  useEffect(() => {
    safeWriteLocalStorage(LS_KEYS.statusFilter, statusFilter);
  }, [statusFilter]);

  useEffect(() => {
    safeWriteLocalStorage(
      LS_KEYS.excludeOriginBlacklist,
      String(excludePredictedOriginBlacklist),
    );
  }, [excludePredictedOriginBlacklist]);

  useEffect(() => {
    safeWriteLocalStorage(
      LS_KEYS.excludeLocationBlacklist,
      String(excludeContactLocationBlacklist),
    );
  }, [excludeContactLocationBlacklist]);

  useEffect(() => {
    safeWriteLocalStorage(
      LS_KEYS.sourceCountries,
      JSON.stringify(Array.from(sourceCountrySelection)),
    );
  }, [sourceCountrySelection]);

  useEffect(() => {
    if (!initializedVisibleColumns) return;
    safeWriteLocalStorage(
      LS_KEYS.visibleColumns,
      JSON.stringify(Array.from(visibleColumnKeys)),
    );
  }, [visibleColumnKeys, initializedVisibleColumns]);

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

  useEffect(() => {
    const validKeys = new Set(sortedRows.map(selectionKeyForRow));
    setSelectedRowKeys((prev) => {
      const next = new Set<string>();
      for (const key of prev) {
        if (validKeys.has(key)) next.add(key);
      }
      return next;
    });
  }, [sortedRows]);

  const allFilteredSelected =
    sortedRows.length > 0 && sortedRows.every((row) => selectedRowKeys.has(selectionKeyForRow(row)));

  const selectedCount = selectedRowKeys.size;

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

  const toggleRowSelection = (row: EnrichedContact) => {
    const key = selectionKeyForRow(row);
    setSelectedRowKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleSelectAllFiltered = () => {
    setSelectedRowKeys((prev) => {
      const next = new Set(prev);
      const keys = sortedRows.map(selectionKeyForRow);
      const currentlyAllSelected =
        keys.length > 0 && keys.every((key) => next.has(key));
      if (currentlyAllSelected) {
        for (const key of keys) next.delete(key);
      } else {
        for (const key of keys) next.add(key);
      }
      return next;
    });
  };

  const exportSelectedRows = () => {
    const selectedRows = sortedRows.filter((row) =>
      selectedRowKeys.has(selectionKeyForRow(row)),
    );
    if (!selectedRows.length) return;
    exportRowsToCsv(selectedRows);
  };

  const openMeetAlfredModal = async () => {
    setMeetAlfredModalOpen(true);
    setSendResultMessage(null);
    if (campaigns.length > 0) return;
    setCampaignsLoading(true);
    setCampaignsError(null);
    try {
      const list = await fetchMeetAlfredCampaigns();
      setCampaigns(list);
      if (list.length > 0) {
        setSelectedCampaignComposite(`${list[0].webhookKey}::${list[0].id}`);
      }
    } catch (e) {
      setCampaignsError(e instanceof Error ? e.message : "Failed to load campaigns");
    } finally {
      setCampaignsLoading(false);
    }
  };

  const sendSelectedToMeetAlfred = async () => {
    const selectedRows = sortedRows.filter((row) =>
      selectedRowKeys.has(selectionKeyForRow(row)),
    );
    if (selectedRows.length === 0) return;
    const [webhookKey, campaignIdRaw] = selectedCampaignComposite.split("::");
    const campaignId = Number(campaignIdRaw);
    if (!webhookKey || !Number.isFinite(campaignId)) {
      setSendResultMessage("Please select a campaign");
      return;
    }
    setSendingToMeetAlfred(true);
    setCampaignsError(null);
    setSendResultMessage(null);
    try {
      const result = await bulkSendMeetAlfred({
        webhookKey,
        campaignId,
        leads: selectedRows.map((row) => ({
          linkedin_profile_url: (row.contactLinkedin ?? "").trim(),
          csv_firstname: firstNameFromRow(row),
          csv_companyname: companyNameFromRow(row),
          csv_email: (row.email ?? "").trim(),
          csv_country: companyCountryFromRow(row),
        })),
      });
      setSendResultMessage(
        `Sent ${result.sent}/${result.attempted} leads (failed: ${result.failed}).`,
      );
    } catch (e) {
      setCampaignsError(e instanceof Error ? e.message : "Failed to send leads");
    } finally {
      setSendingToMeetAlfred(false);
    }
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
            <div className="meta-actions">
              <span className="selection-cart">
                Selected: <strong>{selectedCount}</strong>
              </span>
              <button type="button" className="column-btn" onClick={toggleSelectAllFiltered}>
                {allFilteredSelected ? "Unselect all" : "Select all"}
              </button>
              <button
                type="button"
                className="column-btn"
                disabled={selectedCount === 0}
                onClick={exportSelectedRows}
              >
                Export CSV
              </button>
              <button
                type="button"
                className="column-btn"
                disabled={selectedCount === 0}
                onClick={() => void openMeetAlfredModal()}
              >
                Bulk Send To Meet Alfred
              </button>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="th-check">
                    <span className="check-cell">
                      <input
                        type="checkbox"
                        checked={allFilteredSelected}
                        onChange={toggleSelectAllFiltered}
                        aria-label="Select all filtered rows"
                      />
                    </span>
                  </th>
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
                    <td className="td-check">
                      <span className="check-cell">
                        <input
                          type="checkbox"
                          checked={selectedRowKeys.has(selectionKeyForRow(row))}
                          onChange={() => toggleRowSelection(row)}
                          aria-label="Select row"
                        />
                      </span>
                    </td>
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

      {meetAlfredModalOpen && (
        <div className="modal-backdrop" onClick={() => setMeetAlfredModalOpen(false)}>
          <div className="modal filter-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Send To Meet Alfred</h2>
              <button
                type="button"
                className="modal-close"
                onClick={() => setMeetAlfredModalOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="filter-modal-body">
              <p className="filter-fieldset-hint">
                Selected leads: <strong>{selectedCount}</strong>
              </p>
              <label className="field">
                <span>Campaign</span>
                <select
                  value={selectedCampaignComposite}
                  onChange={(e) => setSelectedCampaignComposite(e.target.value)}
                  disabled={campaignsLoading || campaigns.length === 0}
                >
                  {campaigns.length === 0 ? (
                    <option value="">No campaigns available</option>
                  ) : (
                    campaigns.map((c) => (
                      <option
                        key={`${c.webhookKey}-${c.id}`}
                        value={`${c.webhookKey}::${c.id}`}
                      >
                        {c.label} (id: {c.id})
                      </option>
                    ))
                  )}
                </select>
              </label>
              {campaignsLoading && <div className="meta-filter-hint">Loading campaigns...</div>}
              {campaignsError && <div className="error">{campaignsError}</div>}
              {sendResultMessage && <div className="meta-bar">{sendResultMessage}</div>}
            </div>
            <div className="modal-foot filter-modal-foot">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setMeetAlfredModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={
                  sendingToMeetAlfred ||
                  campaignsLoading ||
                  selectedCount === 0 ||
                  !selectedCampaignComposite
                }
                onClick={() => void sendSelectedToMeetAlfred()}
              >
                {sendingToMeetAlfred ? "Sending..." : "Send"}
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
          <div className="results">
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
              <div className="meta-actions">
                <span className="selection-cart">
                  Selected: <strong>{selectedCount}</strong>
                </span>
                <button type="button" className="column-btn" onClick={toggleSelectAllFiltered}>
                  {allFilteredSelected ? "Unselect all" : "Select all"}
                </button>
                <button
                  type="button"
                  className="column-btn"
                  disabled={selectedCount === 0}
                  onClick={exportSelectedRows}
                >
                  Export CSV
                </button>
                <button
                  type="button"
                  className="column-btn"
                  disabled={selectedCount === 0}
                  onClick={() => void openMeetAlfredModal()}
                >
                  Bulk Send To Meet Alfred
                </button>
              </div>
            </div>
          </div>
          {grouped.map((item) => (
            <section className="results group-card" key={item.company}>
              <div className="meta-bar">
                {item.company} ({item.contacts.length})
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th className="th-check">
                        <span className="check-cell">
                          <input
                            type="checkbox"
                            checked={
                              item.contacts.length > 0 &&
                              item.contacts.every((row) =>
                                selectedRowKeys.has(selectionKeyForRow(row)),
                              )
                            }
                            onChange={() => {
                              setSelectedRowKeys((prev) => {
                                const next = new Set(prev);
                                const keys = item.contacts.map(selectionKeyForRow);
                                const allInGroupSelected =
                                  keys.length > 0 && keys.every((key) => next.has(key));
                                if (allInGroupSelected) {
                                  for (const key of keys) next.delete(key);
                                } else {
                                  for (const key of keys) next.add(key);
                                }
                                return next;
                              });
                            }}
                            aria-label={`Select all rows for ${item.company}`}
                          />
                        </span>
                      </th>
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
                        <td className="td-check">
                          <span className="check-cell">
                            <input
                              type="checkbox"
                              checked={selectedRowKeys.has(selectionKeyForRow(row))}
                              onChange={() => toggleRowSelection(row)}
                              aria-label="Select row"
                            />
                          </span>
                        </td>
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
