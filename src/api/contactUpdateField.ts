export type EditableContactField =
  | "first_name"
  | "contact_name"
  | "title"
  | "contact_linkedin"
  | "contact_location"
  | "predicted_origin_of_name"
  | "is_predicted_origin_blacklisted"
  | "is_contact_location_blacklisted"
  | "added_to_meetalfred_campaign"
  | "not_a_lead";

export async function updateContactField(input: {
  id: number;
  field: EditableContactField;
  value: string | boolean;
}): Promise<boolean> {
  const res = await fetch("/api/contact-update-field", {
    method: "POST",
    headers: { "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify(input),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
  const body = JSON.parse(text) as { ok?: boolean };
  return Boolean(body.ok);
}
