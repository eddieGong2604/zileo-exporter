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
import type { ApolloDecisionMakersResult } from "../types/apollo";

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
    try {
      const { result, unresolved_names } = await fetchApolloDecisionMakers({
        organizationNames,
        person_titles: tags,
        page: 1,
        per_page: 100,
        includeSimilarTitles: includeSimilar,
      });
      setData(result);
      setUnresolvedNames(unresolved_names);
    } catch (e) {
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
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Apollo enrich failed");
    } finally {
      setEnrichLoading(false);
    }
  }, [data, selectedIds]);

  const exportCsv = useCallback(() => {
    if (!data?.people.length) return;
    const rows = data.people.filter((p) => selectedIds.has(p.id));
    if (!rows.length) return;
    const csv = buildDecisionMakersCsv(rows, countryLabel);
    const safeOrg = organizationNames[0]
      ? organizationNames[0].replace(/[^\w\-]+/g, "_").slice(0, 40)
      : "export";
    const stamp = formatFilenameTimestampUtcPlus7();
    downloadTextFile(`decision-makers_${safeOrg}_${stamp}.csv`, csv);
  }, [countryLabel, data, organizationNames, selectedIds]);

  const people = data?.people ?? [];

  const selectedCount = useMemo(
    () => people.filter((p) => selectedIds.has(p.id)).length,
    [people, selectedIds],
  );

  const allSelected = people.length > 0 && selectedCount === people.length;
  const someSelected = selectedCount > 0 && !allSelected;

  useEffect(() => {
    const el = selectAllRef.current;
    if (el) el.indeterminate = someSelected;
  }, [someSelected, allSelected]);

  const selectedPeople = useMemo(
    () => people.filter((p) => selectedIds.has(p.id)),
    [people, selectedIds],
  );

  const canEnrichSelection = selectedPeople.some(
    (p) => !p.email && !p.linkedin_url,
  );

  const hasAnyContact = people.some((p) => p.email || p.linkedin_url);

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
      if (people.length === 0) return new Set();
      const allOn = people.every((p) => prev.has(p.id));
      if (allOn) return new Set();
      return new Set(people.map((p) => p.id));
    });
  }, [people]);

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
          <button
            type="button"
            className="modal-close"
            aria-label="Đóng"
            onClick={onClose}
          >
            ×
          </button>
        </div>

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
            Bước 1: People Search (không tốn bulk_match). Bước 2: khi list ổn,
            bấm <strong>Enrich information</strong> để gọi{" "}
            <code>people/bulk_match</code> / enrich — email &amp; LinkedIn, tốn
            credits Apollo.
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

        {err && <div className="modal-error">{err}</div>}

        {unresolvedNames.length > 0 && (
          <div className="modal-warn">
            Không resolve được organization_id:{" "}
            <span className="mono">{unresolvedNames.join(", ")}</span> — vẫn tìm
            people cho các công ty còn lại.
          </div>
        )}

        {data && (
          <div className="dm-results">
            <div className="dm-results-toolbar">
              <p className="dm-results-meta">
                Tổng khớp (Apollo): {data.total_entries ?? "—"} · Trả về{" "}
                {people.length} người (trang 1).
                {hasAnyContact
                  ? " Đã có dữ liệu enrich (một phần hoặc toàn bộ) — email / LinkedIn theo Apollo."
                  : " Chưa enrich — tick dòng rồi bấm Enrich information để lấy email / LinkedIn (tốn credits)."}
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
                        aria-label="Chọn tất cả dòng"
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
                  {people.map((p) => (
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
          <button
            type="button"
            className="btn-primary"
            disabled={loading || enrichLoading || !tags.length}
            onClick={run}
          >
            {loading ? "Đang gọi Apollo search…" : "Chạy Apollo search"}
          </button>
        </div>
      </div>
    </div>
  );
}
