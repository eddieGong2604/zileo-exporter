export type MeetAlfredCampaign = {
  id: number;
  label: string;
  status?: string;
  webhookKey: string;
};

function meetAlfredCampaignIsActiveForUi(c: MeetAlfredCampaign): boolean {
  return String(c.status ?? "").trim().toLowerCase() === "active";
}

export async function fetchMeetAlfredCampaigns(): Promise<MeetAlfredCampaign[]> {
  const res = await fetch("/api/meet-alfred-campaigns");
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text || `HTTP ${res.status}`);
  }
  const body = JSON.parse(text) as { campaigns?: MeetAlfredCampaign[] };
  const raw = Array.isArray(body.campaigns) ? body.campaigns : [];
  /** Meet Alfred list API has no filter param; only show active campaigns in the dropdown. */
  return raw.filter(meetAlfredCampaignIsActiveForUi);
}

export async function bulkSendMeetAlfred(input: {
  leads: Array<{
    contactId: number;
    webhookKey: string;
    campaignId: number;
    linkedin_profile_url: string;
    csv_firstname: string;
    csv_companyname: string;
    csv_email: string;
    csv_country: string;
    csv_jobtitle: string;
  }>;
}): Promise<{
  attempted: number;
  sent: number;
  failed: number;
  marked: number;
  markedContactIds: number[];
}> {
  const res = await fetch("/api/meet-alfred-bulk-send", {
    method: "POST",
    headers: { "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify(input),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text || `HTTP ${res.status}`);
  }
  return JSON.parse(text) as {
    attempted: number;
    sent: number;
    failed: number;
    marked: number;
    markedContactIds: number[];
  };
}
