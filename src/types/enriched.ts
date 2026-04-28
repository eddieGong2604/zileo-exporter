export type EnrichedContact = {
  id: number | null;
  companyId: number | null;
  contactName: string | null;
  contactLinkedin: string | null;
  apolloProfileHref: string | null;
  contactLocation: string | null;
  source: string | null;
  email: string | null;
  predictedOriginOfName: string | null;
  countryId: string | number | null;
  isPredictedOriginBlacklisted: boolean | null;
  isContactLocationBlacklisted: boolean | null;
  createdAt: string;
  updatedAt: string;
  company: Record<string, unknown> | null;
};
