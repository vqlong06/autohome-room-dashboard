# Supabase backend cho LongOS Sync

Thư mục này chứa backend Health riêng của app. Không trộn migration này với hai bảng phòng công khai nếu chưa review chính xác project đích.

## Thành phần

- `migrations/202608070001_health_steps.sql`: bảng private, RLS và RPC transaction.
- `functions/health-ingest/`: xác thực JWT, validate Steps payload và ingest idempotent.
- `functions/health-delete/`: xóa toàn bộ Health data của caller.
- `tests/`: contract/security tests không cần secret.

## Secret boundary

App chỉ có project URL và publishable key. Edge Function lấy các biến môi trường Supabase:

```text
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY hoặc SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
```

`SUPABASE_SERVICE_ROLE_KEY` chỉ tồn tại trong runtime Edge Function. Không chép giá trị này vào Xcode, Git, web hay log.

## Thứ tự triển khai

1. Tạo/review project Supabase dành cho LongOS Sync hoặc xác nhận dùng chung project với room telemetry.
2. Chạy migration trong SQL Editor hoặc Supabase CLI.
3. Deploy `health-ingest` và `health-delete`.
4. Tạo ít nhất một user email/password cho thử nghiệm.
5. Kiểm tra anon/user A/user B trước khi cài app production.

Ví dụ Supabase CLI khi đã cài:

```bash
supabase functions deploy health-ingest
supabase functions deploy health-delete
```

Không dùng `--no-verify-jwt` như một cách thay thế auth. Hai function tự xác thực token bằng Auth API để hỗ trợ gateway hiện hành, rồi write bằng RPC service-only.

## Test local không cần Deno

```bash
cd "/Users/voquoclong/Downloads/My projects/LongOS/LongOS Sync"
npm ci
npm test
```

Test production bắt buộc:

- anon không SELECT/DML/RPC;
- user A chỉ SELECT row A;
- user B không thấy row A;
- app không có direct INSERT/UPDATE/DELETE;
- cùng request ID/hash trả ACK replay;
- cùng request ID/hash khác trả 409;
- xóa user hoặc delete flow xóa bucket/status/ledger tương ứng.
