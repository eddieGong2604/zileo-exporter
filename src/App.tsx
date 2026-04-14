import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchCompanies } from "./api/companies";
import { fetchCompanyReveal } from "./api/revealCompany";
import { DecisionMakersModal } from "./components/DecisionMakersModal";
import { COUNTRY_OPTIONS } from "./data/countries";
import {
  buildCompaniesCsv,
  downloadTextFile,
  formatFilenameTimestampUtcPlus7,
} from "./lib/csvExport";
import type {
  CompaniesResponse,
  CompanyRevealRowState,
  DatePostedFilter,
} from "./types/zileo";
import "./App.css";

const DEFAULT_KEYWORDS = [
  "javascript",
  "fullstack",
  "frontend",
  "backend",
  "ai engineer",
  "Node.js",
  "npm",
  "webpack",
  "Redux",
  "React Native",
  "Virtual DOM",
  "TypeScript",
  "Vercel",
  "DynamoDB",
  "EC2",
  "S3",
  "AWS",
  "Azure",
  "Google Cloud Platform",
  "Kubernetes",
  "C#",
  ".NET",
  "Python",
  "ASP.NET",
];

function parseKeywords(input: string): string[] {
  return input
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function clampPage(raw: string): number {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return n;
}

function clampLimit(raw: string): number {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return 10;
  return Math.min(100, n);
}

export default function App() {
  const [datePosted, setDatePosted] = useState<DatePostedFilter>("ONE_DAY_AGO");
  const [pageInput, setPageInput] = useState("1");
  const [limitInput, setLimitInput] = useState("10");
  const [country, setCountry] = useState("Australia");
  const [keywordsText, setKeywordsText] = useState(DEFAULT_KEYWORDS.join(", "));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CompaniesResponse | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [decisionModalOpen, setDecisionModalOpen] = useState(false);
  const [revealById, setRevealById] = useState<
    Record<string, CompanyRevealRowState>
  >({});
  const [revealRunning, setRevealRunning] = useState(false);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [result]);

  useEffect(() => {
    setRevealById({});
  }, [result]);

  const rowIds = useMemo(() => result?.data.map((c) => c.id) ?? [], [result]);

  const allSelected =
    rowIds.length > 0 && rowIds.every((id) => selectedIds.has(id));

  const toggleRow = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (!rowIds.length) return;
    setSelectedIds((prev) => {
      if (rowIds.every((id) => prev.has(id))) return new Set();
      return new Set(rowIds);
    });
  }, [rowIds]);

  const selectedOrgNames = useMemo(() => {
    if (!result) return [];
    return result.data
      .filter((c) => selectedIds.has(c.id))
      .map((c) => c.name.trim())
      .filter(Boolean);
  }, [result, selectedIds]);

  const runSearch = useCallback(async () => {
    setLoading(true);
    setError(null);
    const page = clampPage(pageInput);
    const limit = clampLimit(limitInput);
    try {
      const data = await fetchCompanies({
        datePosted,
        page,
        limit,
        keywords: parseKeywords(keywordsText),
        ...(country.trim() ? { country: country.trim() } : {}),
      });
      setResult(data);
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }, [country, datePosted, keywordsText, limitInput, pageInput]);

  const runPageSearch = useCallback(
    async (nextPage: number) => {
      const safePage = Math.max(1, nextPage);
      setPageInput(String(safePage));
      setLoading(true);
      setError(null);
      const limit = clampLimit(limitInput);
      try {
        const data = await fetchCompanies({
          datePosted,
          page: safePage,
          limit,
          keywords: parseKeywords(keywordsText),
          ...(country.trim() ? { country: country.trim() } : {}),
        });
        setResult(data);
      } catch (e) {
        setResult(null);
        setError(e instanceof Error ? e.message : "Request failed");
      } finally {
        setLoading(false);
      }
    },
    [country, datePosted, keywordsText, limitInput],
  );

  const totalPages =
    result && result.meta.limit > 0
      ? Math.max(1, Math.ceil(result.meta.total / result.meta.limit))
      : 0;

  const exportCompanies = useCallback(() => {
    const selectedRows =
      result?.data.filter((c) => selectedIds.has(c.id)) ?? [];
    const rows = selectedRows.length ? selectedRows : (result?.data ?? []);
    if (!rows.length) return;
    const csv = buildCompaniesCsv(rows);
    const scope = selectedRows.length ? "selected" : "page";
    const stamp = formatFilenameTimestampUtcPlus7();
    downloadTextFile(`companies_${scope}_${stamp}.csv`, csv);
  }, [result, selectedIds]);

  const revealCompanies = useCallback(async () => {
    if (!result?.data.length) return;
    const selectedRows = result.data.filter((c) => selectedIds.has(c.id));
    const rows = selectedRows.length ? selectedRows : result.data;
    const countryHint = country.trim() || undefined;

    const initial: Record<string, CompanyRevealRowState> = {};
    for (const c of rows) {
      initial[c.id] = { loading: true };
    }
    setRevealById((prev) => ({ ...prev, ...initial }));
    setRevealRunning(true);

    for (const c of rows) {
      try {
        const data = await fetchCompanyReveal({
          companyName: c.name,
          countryHint,
        });
        setRevealById((prev) => ({
          ...prev,
          [c.id]: {
            loading: false,
            companySize: data.companySize,
            isHeadhunt: data.isHeadhunt,
            isOutsource: data.isOutsource,
          },
        }));
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Request failed";
        setRevealById((prev) => ({
          ...prev,
          [c.id]: { loading: false, error: msg },
        }));
      }
    }
    setRevealRunning(false);
  }, [country, result, selectedIds]);

  return (
    <div className="app">
      <header className="header">
        <h1>Zileo Exporter</h1>
        <p className="subtitle">Công ty đăng tin gần đây</p>
      </header>

      <section className="panel">
        <div className="grid">
          <label className="field">
            <span>Thời gian đăng tin</span>
            <select
              value={datePosted}
              onChange={(e) =>
                setDatePosted(e.target.value as DatePostedFilter)
              }
            >
              <option value="ONE_DAY_AGO">24 giờ qua</option>
              <option value="ONE_WEEK_AGO">7 ngày qua</option>
              <option value="ONE_MONTH_AGO">30 ngày qua</option>
            </select>
          </label>
          <label className="field">
            <span>Quốc gia</span>
            <select
              value={country}
              onChange={(e) => setCountry(e.target.value)}
            >
              <option value="">— Không chọn —</option>
              {COUNTRY_OPTIONS.map((c) => (
                <option key={c.value} value={c.label}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Trang</span>
            <input
              type="number"
              min={1}
              inputMode="numeric"
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value)}
              onBlur={() => setPageInput(String(clampPage(pageInput)))}
            />
          </label>
          <label className="field">
            <span>Giới hạn / trang</span>
            <input
              type="number"
              min={1}
              max={100}
              inputMode="numeric"
              value={limitInput}
              onChange={(e) => setLimitInput(e.target.value)}
              onBlur={() => setLimitInput(String(clampLimit(limitInput)))}
            />
          </label>
        </div>
        <label className="field full">
          <span>Từ khóa (phân tách bằng dấu phẩy hoặc xuống dòng)</span>
          <textarea
            rows={3}
            value={keywordsText}
            onChange={(e) => setKeywordsText(e.target.value)}
          />
        </label>
        <div className="actions">
          <button type="button" onClick={runSearch} disabled={loading}>
            {loading ? "Đang tải…" : "Tìm công ty"}
          </button>
        </div>
      </section>

      {error && <div className="error">{error}</div>}

      {result && (
        <section className="results">
          <div className="meta-bar meta-bar-row">
            <span>
              Trang {result.meta.page} / {totalPages || "—"} · Hiển thị{" "}
              {result.data.length} / {result.meta.total} công ty
            </span>
            <div className="meta-actions">
              <button
                type="button"
                className="btn-export-company"
                disabled={result.data.length === 0}
                onClick={exportCompanies}
              >
                Export Companies CSV
              </button>
              <button
                type="button"
                className="btn-reveal-company"
                disabled={
                  result.data.length === 0 || loading || revealRunning
                }
                onClick={() => void revealCompanies()}
              >
                {revealRunning ? "Checking…" : "Reveal Company Information"}
              </button>
              <button
                type="button"
                className="btn-export"
                disabled={selectedIds.size === 0}
                onClick={() => setDecisionModalOpen(true)}
              >
                Export Decision Makers
              </button>
            </div>
          </div>
          <div className="pager">
            <button
              type="button"
              className="pager-btn"
              disabled={loading || result.meta.page <= 1}
              onClick={() => void runPageSearch(result.meta.page - 1)}
            >
              Prev
            </button>
            <span className="pager-text">
              Page {result.meta.page} / {totalPages || 1}
            </span>
            <button
              type="button"
              className="pager-btn"
              disabled={
                loading || (totalPages > 0 && result.meta.page >= totalPages)
              }
              onClick={() => void runPageSearch(result.meta.page + 1)}
            >
              Next
            </button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="th-check">
                    <span className="check-cell">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleSelectAll}
                        aria-label="Chọn tất cả trang này"
                      />
                    </span>
                  </th>
                  <th>Tên</th>
                  <th>Quốc gia</th>
                  <th>LinkedIn</th>
                  <th>Tin tuyển dụng</th>
                  <th>Job mới nhất</th>
                </tr>
              </thead>
              <tbody>
                {result.data.map((c) => {
                  const rev = revealById[c.id];
                  return (
                    <tr key={c.id}>
                      <td className="td-check">
                        <span className="check-cell">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(c.id)}
                            onChange={() => toggleRow(c.id)}
                            aria-label={`Chọn ${c.name}`}
                          />
                        </span>
                      </td>
                      <td className="name name-with-reveal">
                        <span className="name-text">{c.name}</span>
                        {rev ? (
                          <span className="reveal-inline">
                            {" "}
                            <span className="reveal-sep" aria-hidden="true">
                              ·
                            </span>{" "}
                            {rev.loading ? (
                              <span className="reveal-muted">
                                Checking…
                              </span>
                            ) : rev.error ? (
                              <span className="reveal-error">{rev.error}</span>
                            ) : (
                              <>
                                <span className="reveal-size">
                                  Quy mô:{" "}
                                  <strong>{rev.companySize ?? "—"}</strong>
                                </span>
                                {(rev.isHeadhunt || rev.isOutsource) && (
                                  <span className="reveal-badges">
                                    {rev.isHeadhunt && (
                                      <span className="badge badge-headhunt">
                                        Headhunt
                                      </span>
                                    )}
                                    {rev.isOutsource && (
                                      <span className="badge badge-outsource">
                                        Outsourcing
                                      </span>
                                    )}
                                  </span>
                                )}
                              </>
                            )}
                          </span>
                        ) : null}
                      </td>
                      <td className="td-country">
                        {(c.country ?? "").trim() || "—"}
                      </td>
                      <td>
                        <a
                          className="linkedin-search-link"
                          href={c.linkedinSearchUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Tìm công ty
                        </a>
                      </td>
                      <td className="td-job-sources">
                        {c.jobs?.source && c.jobs.source.length > 0 ? (
                          <ul className="job-source-list">
                            {c.jobs.source.map((url, i) => (
                              <li key={`${c.id}-job-${i}`}>
                                <a
                                  href={url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="job-source-link"
                                >
                                  Tin {i + 1}
                                </a>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        {new Date(c.latestJobPostedAt).toLocaleString(
                          "vi-VN",
                          {
                            dateStyle: "short",
                            timeStyle: "short",
                          },
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <DecisionMakersModal
        open={decisionModalOpen}
        organizationNames={selectedOrgNames}
        countryLabel={country}
        onClose={() => setDecisionModalOpen(false)}
      />
    </div>
  );
}
