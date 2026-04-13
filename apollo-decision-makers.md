# Apollo — Decision makers (REST đúng tài liệu)

## 1. Organization Search

`POST https://api.apollo.io/api/v1/mixed_companies/search`

Tham số query (xem [Organization Search](https://docs.apollo.io/reference/organization-search)):

- `q_organization_name` — tên công ty (từ Zileo), partial match.
- `page`, `per_page`.

Ứng dụng gọi **mỗi tên một lần**, lấy kết quả đầu → `organization_id` (hoặc `id` tùy payload).

**Lưu ý:** endpoint này **tốn credits** theo plan Apollo.

## 2. People API Search

`POST https://api.apollo.io/api/v1/mixed_people/api_search`

Tham số query (xem [People API Search](https://docs.apollo.io/reference/people-api-search)):

- `organization_ids[]` — các id đã resolve ở bước 1.
- `person_titles[]` — job titles.
- `page`, `per_page`, tuỳ chọn `include_similar_titles`.

Header: `x-api-key`, `Cache-Control: no-cache`, `Content-Type: application/json` (body có thể `{}`).

## 3. Bulk People Enrichment (email + LinkedIn)

`POST https://api.apollo.io/api/v1/people/bulk_match`

- Body JSON: `{ "details": [ { "id": "<person id từ bước 2>" }, ... ] }` — tối đa **10** người mỗi request ([Bulk People Enrichment](https://docs.apollo.io/reference/bulk-people-enrichment)).
- Query: `reveal_personal_emails=true` để cố gắng trả về email (tốn credits; GDPR có thể chặn).
- Response `matches[]` thường có `email`, `linkedin_url` (không cần flag reveal riêng cho LinkedIn trong doc).

Project gọi lặp theo chunk 10 id, gộp vào bảng kết quả.

## UI Apollo (tham khảo)

URL cũ trên app (multi name + `personTitles`) chỉ để tham khảo title mặc định; code trong repo dùng hai bước REST ở trên.
