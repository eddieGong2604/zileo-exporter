import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  enrichApolloDecisionMakersPeople,
  fetchApolloDecisionMakers,
} from "../api/apolloDecisionMakers";
import {
  buildDecisionMakersCsv,
  downloadTextFile,
  formatFilenameTimestampUtcPlus7,
} from "../lib/csvExport";
import { createLogger } from "../lib/logger";
import type { ApolloDecisionMakersResult } from "../types/apollo";

const log = createLogger("DecisionMakersModal");

/** Mặc định theo `apollo-decision-makers.md` (personTitles trong URL). */
export const DEFAULT_APOLLO_PERSON_TITLES = [
  "CEO",
  "CTO",
  "CPO",
  "Director of Engineering",
  "Technical Director",
  "Engineering Director",
  "Product Director",
  "Head of Engineering",
  "Head of Technology",
  "Head of Product",
  "Engineering Manager",
] as const;
const PAGE_SIZE = 100;

type Props = {
  open: boolean;
  organizationNames: string[];
  /** Nhãn quốc gia (Zileo) — cột Country trong CSV giống temp_import.csv */
  countryLabel: string;
  onClose: () => void;
};

export function DecisionMakersModal({
  open,
  organizationNames,
  countryLabel,
  onClose,
}: Props) {
  const titleId = useId();
  const [tags, setTags] = useState<string[]>(() => [
    ...DEFAULT_APOLLO_PERSON_TITLES,
  ]);
  const [draft, setDraft] = useState("");
  const [includeSimilar, setIncludeSimilar] = useState(true);
  const [loading, setLoading] = useState(false);
  const [enrichLoading, setEnrichLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<ApolloDecisionMakersResult | null>(null);
  const [unresolvedNames, setUnresolvedNames] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [screen, setScreen] = useState<"setup" | "results">("setup");
  const selectAllRef = useRef<HTMLInputElement>(null);

  const removeTag = useCallback((i: number) => {
    setTags((prev) => prev.filter((_, j) => j !== i));
  }, []);

  const clearTags = useCallback(() => setTags([]), []);

  const commitDraft = useCallback(() => {
    const t = draft.trim();
    if (!t) return;
    setTags((prev) => (prev.includes(t) ? prev : [...prev, t]));
    setDraft("");
  }, [draft]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commitDraft();
      } else if (e.key === "Backspace" && draft === "" && tags.length > 0) {
        setTags((prev) => prev.slice(0, -1));
      }
    },
    [commitDraft, draft, tags.length],
  );

  const run = useCallback(async () => {
    if (!organizationNames.length || !tags.length) return;
    setLoading(true);
    setErr(null);
    setData(null);
    setUnresolvedNames([]);
    setSelectedIds(new Set());
    setCurrentPage(1);
    try {
      log.info("Apollo search run", {
        orgs: organizationNames.length,
        titles: tags.length,
      });
      const { result, unresolved_names } = await fetchApolloDecisionMakers({
        organizationNames,
        person_titles: tags,
        page: 1,
        per_page: 100,
        includeSimilarTitles: includeSimilar,
      });
      setData(result);
      setUnresolvedNames(unresolved_names);
      setScreen("results");
      log.info("Apollo search ok", {
        people: result.people.length,
        unresolved: unresolved_names.length,
      });
    } catch (e) {
      log.error("Apollo search failed", {
        message: e instanceof Error ? e.message : String(e),
      });
      setErr(e instanceof Error ? e.message : "Apollo request failed");
    } finally {
      setLoading(false);
    }
  }, [includeSimilar, organizationNames, tags]);

  const runEnrich = useCallback(async () => {
    if (!data?.people.length) return;
    const selected = data.people.filter((p) => selectedIds.has(p.id));
    const toEnrich = selected.filter((p) => !p.email && !p.linkedin_url);
    if (!toEnrich.length) return;
    setEnrichLoading(true);
    setErr(null);
    try {
      log.info("Enrich run", { count: toEnrich.length });
      const enrichedSubset = await enrichApolloDecisionMakersPeople(toEnrich);
      const byId = new Map(enrichedSubset.map((p) => [p.id, p]));
      setData((prev) =>
        prev
          ? {
              ...prev,
              people: prev.people.map((p) => byId.get(p.id) ?? p),
            }
          : null,
      );
      log.info("Enrich ok", { merged: enrichedSubset.length });
    } catch (e) {
      log.error("Enrich failed", {
        message: e instanceof Error ? e.message : String(e),
      });
      setErr(e instanceof Error ? e.message : "Apollo enrich failed");
    } finally {
      setEnrichLoading(false);
    }
  }, [data, selectedIds]);

  const exportCsv = useCallback(() => {
    if (!data?.people.length) return;
    const rows = data.people.filter((p) => selectedIds.has(p.id));
    if (!rows.length) return;
    log.info("Export CSV (selection)", { rows: rows.length });
    const csv = buildDecisionMakersCsv(rows, countryLabel);
    const safeOrg = organizationNames[0]
      ? organizationNames[0].replace(/[^\w\-]+/g, "_").slice(0, 40)
      : "export";
    const stamp = formatFilenameTimestampUtcPlus7();
    downloadTextFile(`decision-makers_${safeOrg}_${stamp}.csv`, csv);
  }, [countryLabel, data, organizationNames, selectedIds]);

  const exportAllCsv = useCallback(() => {
    if (!data?.people.length) return;
    log.info("Export CSV (all pages)", { rows: data.people.length });
    const csv = buildDecisionMakersCsv(data.people, countryLabel);
    const safeOrg = organizationNames[0]
      ? organizationNames[0].replace(/[^\w\-]+/g, "_").slice(0, 40)
      : "export";
    const stamp = formatFilenameTimestampUtcPlus7();
    downloadTextFile(`decision-makers_all-pages_${safeOrg}_${stamp}.csv`, csv);
  }, [countryLabel, data, organizationNames]);

  const people = data?.people ?? [];
  const totalPages = Math.max(1, Math.ceil(people.length / PAGE_SIZE));
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pagedPeople = people.slice(pageStart, pageStart + PAGE_SIZE);

  const selectedCount = useMemo(
    () => people.filter((p) => selectedIds.has(p.id)).length,
    [people, selectedIds],
  );

  const pageSelectedCount = useMemo(
    () => pagedPeople.filter((p) => selectedIds.has(p.id)).length,
    [pagedPeople, selectedIds],
  );
  const allSelected =
    pagedPeople.length > 0 && pageSelectedCount === pagedPeople.length;
  const someSelected = pageSelectedCount > 0 && !allSelected;

  useEffect(() => {
    const el = selectAllRef.current;
    if (el) el.indeterminate = someSelected;
  }, [someSelected, allSelected]);

  useEffect(() => {
    setCurrentPage((prev) => Math.min(prev, totalPages));
  }, [totalPages]);

  const selectedPeople = useMemo(
    () => people.filter((p) => selectedIds.has(p.id)),
    [people, selectedIds],
  );

  const canEnrichSelection = selectedPeople.some(
    (p) => !p.email && !p.linkedin_url,
  );

  const toggleRow = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      if (pagedPeople.length === 0) return new Set(prev);
      const next = new Set(prev);
      const allOnPage = pagedPeople.every((p) => next.has(p.id));
      if (allOnPage) {
        pagedPeople.forEach((p) => next.delete(p.id));
      } else {
        pagedPeople.forEach((p) => next.add(p.id));
      }
      return next;
    });
  }, [pagedPeople]);

  const backToSetup = useCallback(() => {
    setScreen("setup");
  }, []);

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 id={titleId}>Export Decision Makers</h2>
          <div className="modal-head-actions">
            {screen === "results" && people.length > 0 && (
              <button
                type="button"
                className="btn-export-csv"
                onClick={exportAllCsv}
                disabled={loading || enrichLoading}
              >
                Export all pages CSV
              </button>
            )}
            <button
              type="button"
              className="modal-close"
              aria-label="Đóng"
              onClick={onClose}
            >
              ×
            </button>
          </div>
        </div>

        {screen === "setup" && (
          <>
            <p className="modal-sub">
              {organizationNames.length} công ty —{" "}
              <span className="mono">{organizationNames.join(", ")}</span>
            </p>

            <div className="dm-section">
              <div className="dm-section-head">
                <span className="dm-section-title">Job titles</span>
                <span className="dm-count">× {tags.length}</span>
              </div>
              <label className="dm-label">Include</label>
              <div className="tag-box">
                <div className="tag-chips">
                  {tags.map((tag, i) => (
                    <span key={`${tag}-${i}`} className="tag-pill">
                      {tag}
                      <button
                        type="button"
                        className="tag-remove"
                        aria-label={`Xóa ${tag}`}
                        onClick={() => removeTag(i)}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <input
                    className="tag-input"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={onKeyDown}
                    placeholder="Gõ title, Enter để thêm…"
                  />
                </div>
                <div className="tag-actions">
                  <button
                    type="button"
                    className="tag-icon-btn"
                    aria-label="Xóa hết title"
                    onClick={clearTags}
                  >
                    ×
                  </button>
                </div>
              </div>
              <p className="dm-hint">
                Bước 1: People Search (không tốn bulk_match). Bước 2: khi list
                ổn, bấm <strong>Enrich information</strong> để gọi{" "}
                <code>people/bulk_match</code> / enrich — email &amp; LinkedIn,
                tốn credits Apollo.
              </p>
              <label className="dm-check">
                <input
                  type="checkbox"
                  checked={includeSimilar}
                  onChange={(e) => setIncludeSimilar(e.target.checked)}
                />
                Include people with similar titles
              </label>
            </div>
          </>
        )}

        {err && <div className="modal-error">{err}</div>}

        {screen === "results" && unresolvedNames.length > 0 && (
          <div className="modal-warn">
            Không resolve được organization_id:{" "}
            <span className="mono">{unresolvedNames.join(", ")}</span> — vẫn tìm
            people cho các công ty còn lại.
          </div>
        )}

        {screen === "results" && data && (
          <div className="dm-results">
            <div className="dm-results-toolbar">
              <p className="dm-results-meta">
                Tổng khớp (Apollo): {data.total_entries ?? "—"},
                <strong>Đã chọn {selectedCount} người</strong>
              </p>
              <div className="dm-results-actions">
                <button
                  type="button"
                  className="btn-enrich"
                  onClick={() => void runEnrich()}
                  disabled={
                    !people.length ||
                    enrichLoading ||
                    loading ||
                    selectedCount === 0 ||
                    !canEnrichSelection
                  }
                >
                  {enrichLoading
                    ? "Đang enrich…"
                    : selectedCount === 0
                      ? "Enrich information"
                      : !canEnrichSelection
                        ? "Đã có Email/LinkedIn (selection)"
                        : "Enrich information"}
                </button>
                <button
                  type="button"
                  className="btn-export-csv"
                  onClick={exportCsv}
                  disabled={!people.length || selectedCount === 0}
                >
                  Export CSV
                </button>
              </div>
            </div>
            {people.length > 0 && (
              <div
                className="dm-pagination"
                role="navigation"
                aria-label="Phân trang kết quả"
              >
                <span className="dm-page-meta">
                  Trang {currentPage}/{totalPages} · {PAGE_SIZE} người/trang
                </span>
                <div className="dm-page-nav">
                  <button
                    type="button"
                    className="dm-page-btn"
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                  >
                    Trước
                  </button>
                  <button
                    type="button"
                    className="dm-page-btn"
                    onClick={() =>
                      setCurrentPage((p) => Math.min(totalPages, p + 1))
                    }
                    disabled={currentPage === totalPages}
                  >
                    Sau
                  </button>
                </div>
              </div>
            )}
            <div className="dm-table-wrap dm-table-wide">
              <table className="dm-table">
                <thead>
                  <tr>
                    <th className="dm-th-check" scope="col">
                      <input
                        ref={selectAllRef}
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleSelectAll}
                        aria-label="Chọn hoặc bỏ chọn tất cả dòng trên trang này (các trang khác không đổi)"
                      />
                    </th>
                    <th>Tên</th>
                    <th>Title</th>
                    <th>Công ty</th>
                    <th>Email</th>
                    <th>LinkedIn</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedPeople.map((p) => (
                    <tr key={p.id}>
                      <td className="dm-td-check">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(p.id)}
                          onChange={() => toggleRow(p.id)}
                          aria-label={`Chọn ${[p.first_name, p.last_name_obfuscated].filter(Boolean).join(" ") || p.id}`}
                        />
                      </td>
                      <td>
                        {[p.first_name, p.last_name_obfuscated]
                          .filter(Boolean)
                          .join(" ")}
                      </td>
                      <td>{p.title ?? "—"}</td>
                      <td>{p.organization?.name ?? "—"}</td>
                      <td className="mono">
                        {p.email ? (
                          <a href={`mailto:${p.email}`}>{p.email}</a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="mono small">
                        {p.linkedin_url ? (
                          <a
                            href={p.linkedin_url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Profile
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="modal-foot">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Đóng
          </button>
          {screen === "results" ? (
            <button
              type="button"
              className="btn-secondary"
              disabled={loading || enrichLoading}
              onClick={backToSetup}
            >
              Quay lại bộ lọc
            </button>
          ) : (
            <button
              type="button"
              className="btn-primary"
              disabled={loading || enrichLoading || !tags.length}
              onClick={run}
            >
              {loading ? "Đang gọi Apollo search…" : "Chạy Apollo search"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
