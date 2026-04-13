export interface ApolloPerson {
  id: string;
  first_name?: string;
  last_name_obfuscated?: string;
  title?: string | null;
  organization?: { name?: string };
}

/** Sau bulk_match + reveal_personal_emails (có thể có email, linkedin). */
export interface ApolloPersonEnriched extends ApolloPerson {
  email?: string | null;
  linkedin_url?: string | null;
}

export interface ApolloPeopleSearchResponse {
  total_entries?: number;
  people?: ApolloPerson[];
}

export type ApolloDecisionMakersResult = {
  total_entries?: number;
  people: ApolloPersonEnriched[];
};
