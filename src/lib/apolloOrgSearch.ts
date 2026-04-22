/** Parse body từ POST .../mixed_companies/search */
export function firstOrganizationId(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const list = d.organizations as unknown[];
  const listAccounts = d.accounts as unknown[];
  if (
    !Array.isArray(list) ||
    list.length === 0 ||
    !Array.isArray(listAccounts) ||
    listAccounts.length === 0
  )
    return null;
  const first = list[0] as Record<string, unknown>;
  const firstAccount = listAccounts[0] as Record<string, unknown>;

  const oid = first.id ?? firstAccount.organization_id;

  return typeof oid === "string" ? oid : null;
}
