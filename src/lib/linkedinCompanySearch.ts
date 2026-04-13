/** Bỏ dấu ngoặc kép trong tên công ty trước khi đưa vào URL tìm kiếm LinkedIn. */
export function companyNameForLinkedInSearch(name: string): string {
  return name.replace(/"/g, "").trim();
}

/** URL tìm công ty trên LinkedIn (trang Companies), dạng keywords + origin cố định. */
export function linkedinCompanySearchUrl(companyName: string): string {
  const keywords = companyNameForLinkedInSearch(companyName);
  const q = encodeURIComponent(keywords);
  return `https://www.linkedin.com/search/results/companies/?keywords=${q}&origin=SWITCH_SEARCH_VERTICAL`;
}
