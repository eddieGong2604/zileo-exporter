export type DatePostedFilter =
  | "ONE_DAY_AGO"
  | "ONE_WEEK_AGO"
  | "ONE_MONTH_AGO";

export interface Company {
  id: string;
  name: string;
  logoUrl: string;
  latestJobPostedAt: string;
}

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
