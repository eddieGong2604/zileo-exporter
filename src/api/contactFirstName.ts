export async function updateContactFirstName(input: {
  id: number;
  firstName: string;
}): Promise<boolean> {
  const res = await fetch("/api/contact-first-name", {
    method: "POST",
    headers: { "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify(input),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text || `HTTP ${res.status}`);
  }
  const body = JSON.parse(text) as { ok?: boolean };
  return Boolean(body.ok);
}
