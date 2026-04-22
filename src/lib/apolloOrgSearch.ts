/** Parse body từ POST .../mixed_companies/search */
export function firstOrganizationId(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const list = d.organizations as unknown[];
  if (!Array.isArray(list) || list.length === 0) return null;
  const first = list[0] as Record<string, unknown>;
  const oid = first.organization_id ?? first.id;
  return typeof oid === "string" ? oid : null;
}
