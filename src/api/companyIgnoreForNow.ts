export async function ignoreCompanyForNow(input: {
  companyId: number;
}): Promise<boolean> {
  const res = await fetch("/api/company-ignore-for-now", {
    method: "POST",
    headers: { "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify(input),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
  const body = JSON.parse(text) as { ok?: boolean };
  return Boolean(body.ok);
}
