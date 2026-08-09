# Kiến trúc LongOS Sync

## Mục tiêu

LongOS Sync là cầu nối riêng tư:

```text
Apple Watch → HealthKit trên iPhone → LongOS Sync → Supabase → LongOS
```

App đồng bộ ba chỉ số HealthKit: Steps, Active Energy và bản tóm tắt Sleep. Website không thể đánh thức app iPhone; background scheduling của iOS không có SLA.

## Ranh giới hệ thống

- HealthKit chỉ được đọc trên iPhone.
- App không ghi dữ liệu HealthKit.
- Steps và Active Energy dùng thống kê HealthKit đã hợp nhất nguồn, không upload raw samples.
- Sleep chỉ upload bản tổng hợp theo ngày gồm giờ ngủ, giờ thức và phút thực ngủ; không upload raw sleep stages.
- Room telemetry hiện tại vẫn công khai và không được dùng làm nơi lưu Health.
- Health tables chỉ đọc được bởi chính tài khoản đã đăng nhập.
- Mọi write đi qua `health-ingest`; app không có quyền DML trực tiếp.
- Service credential chỉ tồn tại trong môi trường Edge Function.

## Luồng đồng bộ

1. Người dùng đăng nhập Supabase.
2. Người dùng đọc giải thích và xin quyền Steps, Active Energy và Sleep từ HealthKit.
3. Người dùng bật consent upload riêng; mặc định consent này tắt.
4. App chạy `HKStatisticsCollectionQuery` theo bucket một giờ cho Steps/Active Energy và `HKSampleQuery` cho Sleep trong hôm nay cùng 7 ngày trước.
5. Mỗi bucket có định danh deterministic và được lưu vào SwiftData trước khi gửi.
6. Uploader gửi từng request idempotent, xóa hàng đợi chỉ sau ACK.
7. Edge Function xác thực JWT, tự lấy user ID, validate payload và gọi RPC transaction.
8. Supabase upsert bucket, cập nhật sync status và lưu batch ledger/hash.

## Cơ hội đồng bộ

- Nhấn **Đồng bộ ngay**.
- App launch/foreground.
- `HKObserverQuery` báo một trong ba loại dữ liệu thay đổi.
- HealthKit background delivery, tối đa theo cadence iOS cho phép.
- `BGAppRefreshTask` là cơ hội bổ sung, không phải lịch chính xác.

Nếu iPhone khóa, app bị force-quit hoặc iOS không cấp thời gian nền, dữ liệu sẽ được bù khi app có cơ hội chạy lại.

## Tính nhất quán

App không dùng anchor. Mỗi lần sync tính lại cửa sổ hữu hạn nên dữ liệu Watch đồng bộ trễ sẽ sửa bucket cũ bằng upsert. Các khoảng Sleep đang ngủ bị chồng lấn được hợp nhất để tránh đếm trùng giữa Apple Watch và iPhone; khoảng thức dài hơn 90 phút tách thành episode khác và app chọn episode dài nhất theo ngày thức dậy.

## Thời gian

Mỗi bucket lưu đồng thời:

- `start` và `end` UTC;
- `timezone_id`;
- `utc_offset_minutes` tại bucket;
- `local_date` tại nơi dữ liệu được nhóm.

App snapshot múi giờ hiện tại của iPhone cho toàn bộ một lần reconciliation để request nhất quán. Với dữ liệu backfill được đọc lần đầu sau khi đi xa, HealthKit không cung cấp chắc chắn múi giờ lịch sử; LongOS giữ UTC làm nguồn thời gian chính và không suy đoán vị trí cũ. ID bucket không chứa múi giờ, khớp khóa idempotent backend.
