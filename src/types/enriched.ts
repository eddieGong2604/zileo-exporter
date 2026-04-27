export type EnrichedContact = {
  id: number | null;
  companyId: number | null;
  contactName: string | null;
  contactLinkedin: string | null;
  apolloProfileHref: string | null;
  contactLocation: string | null;
  source: string | null;
  email: string | null;
  createdAt: string;
  updatedAt: string;
  company: Record<string, unknown> | null;
};
