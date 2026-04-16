export type DatePostedFilter =
  | "ONE_DAY_AGO"
  | "ONE_WEEK_AGO"
  | "ONE_MONTH_AGO";

export interface CompanyJobs {
  /** URL các tin tuyển dụng (vd. Indeed) từ API. */
  source?: string[];
}

export interface Company {
  id: string;
  name: string;
  logoUrl: string;
  /** Quốc gia công ty (từ API). */
  country?: string;
  jobs?: CompanyJobs;
  latestJobPostedAt: string;
  /** URL tìm công ty trên LinkedIn (bổ sung phía client sau khi gọi API). */
  linkedinSearchUrl: string;
}

/** Bản ghi công ty từ API Zileo (chưa có URL LinkedIn). */
export type CompanyFromApi = Omit<Company, "linkedinSearchUrl">;

export interface CompaniesMeta {
  page: number;
  limit: number;
  total: number;
}

export interface CompaniesResponse {
  data: Company[];
  meta: CompaniesMeta;
}

export interface CompaniesSearchBody {
  datePosted: DatePostedFilter;
  page: number;
  limit: number;
  keywords: string[];
  country?: string;
}

/** Kết quả reveal từ OpenAI (web search) — đồng bộ với JSON API `/api/reveal-company`. */
export interface CompanyRevealResult {
  companySize: string;
  isHeadhunt: boolean;
  isOutsource: boolean;
}

/** Kết quả reveal từ Tavily — đồng bộ với JSON API `/api/reveal-company-v2`. */
export interface CompanyRevealV2Result {
  companyName: string;
  matchedUrl: string | null;
  industry: string;
  companySize: string;
  source: "tavily";
  confidence: "high" | "medium" | "low";
}

/** State UI cho một dòng reveal (có thể đang tải hoặc lỗi). */
export interface CompanyRevealRowState {
  loading: boolean;
  companySize?: string;
  industry?: string;
  confidence?: "high" | "medium" | "low";
  matchedUrl?: string | null;
  error?: string;
}
