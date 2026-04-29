export async function bulkRevealEmails(input: {
  contacts: Array<{
    id: number;
    linkedinUrl: string;
    firstName: string;
    contactName: string;
    companyName: string;
  }>;
}): Promise<{
  requested: number;
  matchedWithEmail: number;
  updated: number;
  updates: Array<{ id: number; email: string }>;
}> {
  const res = await fetch("/api/apollo-bulk-reveal-emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify(input),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
  return JSON.parse(text) as {
    requested: number;
    matchedWithEmail: number;
    updated: number;
    updates: Array<{ id: number; email: string }>;
  };
}
