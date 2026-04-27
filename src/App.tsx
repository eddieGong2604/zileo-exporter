import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchCompanies } from "./api/companies";
import { fetchCompanyRevealV2 } from "./api/revealCompanyV2";
import { DecisionMakersModal } from "./components/DecisionMakersModal";
import { EnrichedPage } from "./components/EnrichedPage";
import { createLogger } from "./lib/logger";
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

const log = createLogger("App");

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

function parseCompanySizeUpperBound(companySize?: string): number | null {
  const raw = (companySize ?? "").trim();
  if (!raw) return null;
  const normalized = raw.replace(/,/g, "");
  const rangeMatch = normalized.match(/(\d+)\s*-\s*(\d+)/);
  if (rangeMatch?.[2]) return Number(rangeMatch[2]);
  const plusMatch = normalized.match(/(\d+)\s*\+/);
  if (plusMatch?.[1]) return Number(plusMatch[1]);
  const singleMatch = normalized.match(/\b(\d+)\b/);
  if (singleMatch?.[1]) return Number(singleMatch[1]);
  return null;
}

function isTargetCompany(input: {
  companySize?: string;
  industry?: string;
}): boolean {
  const rawSize = (input.companySize ?? "").trim().replace(/,/g, "");
  const rangeMatch = rawSize.match(/(\d+)\s*-\s*(\d+)/);
  let hasUnder1000Headcount = false;
  if (rangeMatch?.[1]) {
    hasUnder1000Headcount = Number(rangeMatch[1]) < 1000;
  } else {
    const upperBound = parseCompanySizeUpperBound(input.companySize);
    hasUnder1000Headcount = upperBound !== null && upperBound < 1000;
  }
  if (!hasUnder1000Headcount) return false;
  const industry = (input.industry ?? "").toLowerCase();
  if (!industry) return false;
  return (
    !industry.includes("staffing") &&
    !industry.includes("headhunting") &&
    !industry.includes("human resources")
  );
}

export default function App() {
  const pathname = window.location.pathname.replace(/\/+$/, "") || "/";
  if (pathname === "/enriched") {
    return <EnrichedPage />;
  }

  const [datePosted, setDatePosted] = useState<DatePostedFilter>("ONE_DAY_AGO");
  const [pageInput, setPageInput] = useState("1");
  const [limitInput, setLimitInput] = useState("10");
  const [country, setCountry] = useState("Australia");
  const [keywordsText, setKeywordsText] = useState(DEFAULT_KEYWORDS.join(", "));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CompaniesResponse | null>(null);
  const [selectedCompanies, setSelectedCompanies] = useState<
    Record<string, { name: string }>
  >({});
  const [decisionModalOpen, setDecisionModalOpen] = useState(false);
  const [revealById, setRevealById] = useState<
    Record<string, CompanyRevealRowState>
  >({});
  const [revealRunning, setRevealRunning] = useState(false);

  useEffect(() => {
    setRevealById({});
  }, [result]);

  const rowIds = useMemo(() => result?.data.map((c) => c.id) ?? [], [result]);

  const selectedCount = useMemo(
    () => Object.keys(selectedCompanies).length,
    [selectedCompanies],
  );

  const allSelected =
    rowIds.length > 0 && rowIds.every((id) => Boolean(selectedCompanies[id]));

  const toggleRow = useCallback((id: string, name: string) => {
    setSelectedCompanies((prev) => {
      if (prev[id]) {
        const { [id]: _removed, ...rest } = prev;
        return rest;
      }
      return { ...prev, [id]: { name } };
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (!rowIds.length || !result?.data.length) return;
    setSelectedCompanies((prev) => {
      const pageAllSelected = rowIds.every((id) => Boolean(prev[id]));
      if (pageAllSelected) {
        const next = { ...prev };
        for (const id of rowIds) delete next[id];
        return next;
      }
      const next = { ...prev };
      for (const c of result.data) {
        next[c.id] = { name: c.name.trim() };
      }
      return next;
    });
  }, [result, rowIds]);

  const selectedOrgNames = useMemo(() => {
    const names = Object.values(selectedCompanies)
      .map((c) => c.name.trim())
      .filter(Boolean);
    return [...new Set(names)];
  }, [selectedCompanies]);

  const runSearch = useCallback(async () => {
    setLoading(true);
    setError(null);
    const page = clampPage(pageInput);
    const limit = clampLimit(limitInput);
    try {
      log.info("runSearch", { page, limit });
      const data = await fetchCompanies({
        datePosted,
        page,
        limit,
        keywords: parseKeywords(keywordsText),
        ...(country.trim() ? { country: country.trim() } : {}),
      });
      setResult(data);
    } catch (e) {
      log.error("runSearch failed", {
        message: e instanceof Error ? e.message : String(e),
      });
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
        log.info("runPageSearch", { page: safePage, limit });
        const data = await fetchCompanies({
          datePosted,
          page: safePage,
          limit,
          keywords: parseKeywords(keywordsText),
          ...(country.trim() ? { country: country.trim() } : {}),
        });
        setResult(data);
      } catch (e) {
        log.error("runPageSearch failed", {
          message: e instanceof Error ? e.message : String(e),
        });
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
      result?.data.filter((c) => Boolean(selectedCompanies[c.id])) ?? [];
    const rows = selectedRows.length ? selectedRows : (result?.data ?? []);
    if (!rows.length) return;
    const csv = buildCompaniesCsv(rows, revealById);
    const scope = selectedRows.length ? "selected" : "page";
    const stamp = formatFilenameTimestampUtcPlus7();
    downloadTextFile(`companies_${scope}_${stamp}.csv`, csv);
  }, [result, selectedCompanies, revealById]);

  const revealCompanies = useCallback(async () => {
    if (!result?.data.length) return;
    const selectedRows = result.data.filter((c) =>
      Boolean(selectedCompanies[c.id]),
    );
    const rows = selectedRows.length ? selectedRows : result.data;
    const revealCountry = country.trim() || undefined;

    const initial: Record<string, CompanyRevealRowState> = {};
    for (const c of rows) {
      initial[c.id] = { loading: true };
    }
    setRevealById((prev) => ({ ...prev, ...initial }));
    setRevealRunning(true);

    log.info("revealCompanies start", { rowCount: rows.length });
    for (const c of rows) {
      try {
        const data = await fetchCompanyRevealV2({
          companyName: c.name,
          country: revealCountry,
        });
        setRevealById((prev) => ({
          ...prev,
          [c.id]: {
            loading: false,
            companySize: data.companySize,
            industry: data.industry,
            confidence: data.confidence,
            matchedUrl: data.matchedUrl,
          },
        }));
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Request failed";
        log.warn("revealCompanies row failed", { id: c.id, name: c.name, msg });
        setRevealById((prev) => ({
          ...prev,
          [c.id]: { loading: false, error: msg },
        }));
      }
    }
    log.info("revealCompanies done");
    setRevealRunning(false);
  }, [country, result, selectedCompanies]);

  return (
    <div className="app">
      <header className="header">
        <h1>Zileo Exporter</h1>
        <p className="subtitle">Công ty đăng tin gần đây</p>
        <div className="route-links">
          <a href="/" aria-current="page">
            Search
          </a>
          <a href="/enriched">Enriched</a>
        </div>
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
              <span className="selection-cart">
                Cart: <strong>{selectedCount}</strong> Công ty
              </span>
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
                disabled={result?.data.length === 0 || loading || revealRunning}
                onClick={() => void revealCompanies()}
              >
                {revealRunning ? "Checking…" : "Reveal Company Information"}
              </button>

              <button
                type="button"
                className="btn-export"
                disabled={selectedCount === 0}
                onClick={() => setDecisionModalOpen(true)}
              >
                Export Decision Makers
              </button>
              <button
                type="button"
                className="btn-export"
                disabled={selectedCount === 0}
                onClick={() => setSelectedCompanies({})}
              >
                Xoá Cart
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
                  const linkedInUrl =
                    rev?.matchedUrl?.trim() || c.linkedinSearchUrl;
                  const linkedInLabel = rev?.matchedUrl?.trim()
                    ? "LinkedIn matched"
                    : "Tìm công ty";
                  const targetStar = isTargetCompany({
                    companySize: rev?.companySize,
                    industry: rev?.industry,
                  });
                  return (
                    <tr key={c.id}>
                      <td className="td-check">
                        <span className="check-cell">
                          <input
                            type="checkbox"
                            checked={Boolean(selectedCompanies[c.id])}
                            onChange={() => toggleRow(c.id, c.name)}
                            aria-label={`Chọn ${c.name}`}
                          />
                        </span>
                      </td>
                      <td className="name name-with-reveal">
                        <span className="name-text">
                          {c.name}
                          {targetStar && (
                            <span
                              className="target-star"
                              title="Target fit: quy mo < 500 va industry khong chua Software Development/IT Services"
                              aria-label="Target company"
                            >
                              {" "}
                              ⭐
                            </span>
                          )}
                        </span>
                        {rev ? (
                          <span className="reveal-inline">
                            {rev.loading ? (
                              <span className="reveal-muted">Checking…</span>
                            ) : rev.error ? (
                              <span className="reveal-error">{rev.error}</span>
                            ) : (
                              <>
                                <span className="reveal-size">
                                  Quy mô:{" "}
                                  <strong>{rev.companySize ?? "—"}</strong>
                                </span>
                                <span className="reveal-size">
                                  Industry:{" "}
                                  <strong>{rev.industry ?? "—"}</strong>
                                </span>
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
                          href={linkedInUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {linkedInLabel}
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
                        {new Date(c.latestJobPostedAt).toLocaleString("vi-VN", {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
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
