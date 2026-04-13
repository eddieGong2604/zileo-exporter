import raw from "../../country.json";

export type CountryOption = { value: number; label: string };

const rows = raw.result as CountryOption[];

/** Danh sách quốc gia (label gửi lên Zileo API), bỏ mục “None”. */
export const COUNTRY_OPTIONS: CountryOption[] = [...rows]
  .filter((c) => c.label && c.label !== "- None Specified -")
  .sort((a, b) => a.label.localeCompare(b.label, "en"));
