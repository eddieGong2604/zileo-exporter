import type { ApolloPersonEnriched } from "../types/apollo";
import type { Company } from "../types/zileo";

type CompanyRevealForExport = {
  companySize?: string;
  isHeadhunt?: boolean;
  isOutsource?: boolean;
};

/** Ngày giờ theo UTC+7 (Asia/Ho_Chi_Minh), dùng cho tên file: `yyyy-mm-dd_HH-mm-ss`. */
export function formatFilenameTimestampUtcPlus7(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "00";

  const y = get("year");
  const mo = get("month");
  const d = get("day");
  const h = get("hour");
  const mi = get("minute");
  const s = get("second");
  return `${y}-${mo}-${d}_${h}-${mi}-${s}`;
}

/** Theo temp_import.csv, không có Employees Count. */
const HEADER = "First Name,Company Name,Email,LinkedIn,Country";

function escapeCsvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function row(
  firstName: string,
  company: string,
  email: string,
  linkedIn: string,
  country: string,
): string {
  return [
    escapeCsvCell(firstName),
    escapeCsvCell(company),
    escapeCsvCell(email),
    escapeCsvCell(linkedIn),
    escapeCsvCell(country),
  ].join(",");
}

export function buildDecisionMakersCsv(
  people: ApolloPersonEnriched[],
  countryLabel: string,
): string {
  const lines = [HEADER];
  const country = countryLabel.trim();
  for (const p of people) {
    const first = (p.first_name ?? "").trim();
    const company = (p.organization?.name ?? "").trim();
    const email = (p.email ?? "").trim();
    const linkedin = (p.linkedin_url ?? "").trim();
    lines.push(row(first, company, email, linkedin, country));
  }
  return lines.join("\r\n");
}

const COMPANY_HEADER =
  "Company Name,Company ID,Country,Job Source URLs,Company Size,Is Headhunt,Is Outsourcing,Latest Job Posted At,LinkedIn Search URL";

export function buildCompaniesCsv(
  companies: Company[],
  revealById?: Record<string, CompanyRevealForExport>,
): string {
  const lines = [COMPANY_HEADER];
  for (const c of companies) {
    const jobUrls = (c.jobs?.source ?? []).filter(Boolean).join(" | ");
    const reveal = revealById?.[c.id];
    lines.push(
      [
        escapeCsvCell((c.name ?? "").trim()),
        escapeCsvCell((c.id ?? "").trim()),
        escapeCsvCell((c.country ?? "").trim()),
        escapeCsvCell(jobUrls),
        escapeCsvCell((reveal?.companySize ?? "").trim()),
        escapeCsvCell(String(Boolean(reveal?.isHeadhunt))),
        escapeCsvCell(String(Boolean(reveal?.isOutsource))),
        escapeCsvCell((c.latestJobPostedAt ?? "").trim()),
        escapeCsvCell((c.linkedinSearchUrl ?? "").trim()),
      ].join(","),
    );
  }
  return lines.join("\r\n");
}

export function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
