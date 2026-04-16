# Tavily Plan - reveal-company v2

## Muc tieu

Xay dung API `reveal-company (v2)` de reveal:

- `industry`
- `companySize` (so nhan su theo range LinkedIn, vd `11-50 employees`)

Du lieu duoc lay tu Tavily API, uu tien ket qua LinkedIn company page.

## Input / Output de xuat

### Request body (client -> server)

```json
{
  "companyName": "Blinx Solutions",
  "countryHint": "UK"
}
```

`countryHint` la optional, dung de giam nhieu Công ty trung ten.

### Response body (server -> client)

```json
{
  "companyName": "Blinx Solutions",
  "matchedUrl": "https://uk.linkedin.com/company/blinxsolutions",
  "industry": "IT Services and IT Consulting",
  "companySize": "11-50 employees",
  "source": "tavily",
  "confidence": "high"
}
```

### Error response

```json
{
  "error": "No matching LinkedIn company result found"
}
```

## Tavily request strategy

Theo format mau trong `tavily-request.sample.MD`:

- Query chinh:
  - `LinkedIn of ${companyName}`
- Neu co `country`:
  - `LinkedIn of ${companyName} ${country}`
- Su dung `searchDepth: "advanced"` de lay content day du hon.

Co the them 1 query fallback neu khong tim thay:

- `${companyName} LinkedIn company`

## Loc ket qua Tavily

Tavily tra ve list `results[]` (nhu `tavily-response.sample.json`).
Can filter theo dung thu tu:

1. `url` chua `linkedin.com/company/`
2. `content` hoac `title` chua ten Công ty (`companyName`) sau khi normalize:
   - lowercase
   - bo khoang trang thua
   - bo ky tu dac biet nhe (neu can)
3. Uu tien score cao nhat.

Neu co nhieu ket qua hop le:

- sort giam dan theo `score`

## Parse industry va company size

Tu `result.content`, dung regex parser:

- Industry:
  - tim pattern sau heading `### Industry`
  - lay dong text tiep theo khong rong

- Company size:
  - tim pattern sau heading `### Company Size`
  - lay dong dau tien co chu `employees`

Fallback parsing:

- neu heading khong co, tim pattern chung:
  - `Industry` + dong ke tiep
  - regex `\b\d{1,3}(,\d{3})?-\d{1,3}(,\d{3})?\s+employees\b` hoac `\b\d+\+\s+employees\b`

Neu khong parse duoc:

- `industry = "Unknown"`
- `companySize = "Unknown"`
- `confidence = "medium"` hoac `"low"`

## API endpoint implementation (v2)

De xuat tao endpoint moi:

- `api/reveal-company-v2.ts`

Flow:

1. Validate method POST
2. Validate `companyName`
3. Goi Tavily API
4. Filter ket qua LinkedIn company page dung ten Công ty
5. Parse `industry` + `companySize`
6. Return JSON

Env can co:

- `TAVILY_API_KEY`

## Pseudocode

```ts
const results = await tavily.search(query, { searchDepth: "advanced" });
const candidates = results
  .filter(isLinkedInCompanyUrl)
  .filter(matchesCompanyName);
const best = pickBestCandidate(candidates, country);
if (!best) throw 404;

const industry = extractIndustry(best.content);
const companySize = extractCompanySize(best.content);

return {
  companyName,
  matchedUrl: best.url,
  industry: industry ?? "Unknown",
  companySize: companySize ?? "Unknown",
  source: "tavily",
  confidence: computeConfidence(best, industry, companySize),
};
```

## Test cases can cover

1. **Happy path**: `Blinx Solutions` -> dung URL company + parse du 2 field
2. **Many similar companies**: `Blinx` -> phai chon dung ten day du
3. **No LinkedIn company result** -> 404 ro rang
4. **Missing field in content** -> tra `Unknown` thay vi fail
5. **Case-insensitive matching** -> `blinx solutions` van match

## Rollout notes

- Giu lai API cu (`/api/reveal-company`) de tranh break flow hien tai.
- Frontend co the them function moi `fetchCompanyRevealV2`.
- Log them candidate URLs trong dev mode de debug de hon.
