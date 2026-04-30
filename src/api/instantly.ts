export type InstantlyCampaign = {
  id: string;
  name: string;
  status?: number;
};

export async function fetchInstantlyCampaigns(): Promise<InstantlyCampaign[]> {
  const res = await fetch("/api/instantly-campaigns");
  const text = await res.text();
  if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
  const body = JSON.parse(text) as { campaigns?: InstantlyCampaign[] };
  return Array.isArray(body.campaigns) ? body.campaigns : [];
}

export async function bulkSendInstantly(input: {
  campaignId: string;
  leads: Array<{
    contactId: number;
    email: string;
    first_name: string;
    company_name: string;
  }>;
}): Promise<{
  attempted: number;
  totalSent: number;
  leadsUploaded: number;
  skippedCount: number;
  invalidEmailCount: number;
  duplicateEmailCount: number;
  incompleteCount: number;
  markedInstantly: number;
}> {
  const res = await fetch("/api/instantly-bulk-send", {
    method: "POST",
    headers: { "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify(input),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
  return JSON.parse(text) as {
    attempted: number;
    totalSent: number;
    leadsUploaded: number;
    skippedCount: number;
    invalidEmailCount: number;
    duplicateEmailCount: number;
    incompleteCount: number;
    markedInstantly: number;
  };
}
