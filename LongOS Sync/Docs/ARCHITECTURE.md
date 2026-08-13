# Kiến trúc LongOS Sync

## Mục tiêu

LongOS Sync là cầu nối riêng tư:

```text
Apple Watch → HealthKit trên iPhone → LongOS Sync → Supabase → LongOS
```

App đồng bộ Steps, Active Energy, Sleep/REM/Deep, HRV SDNN, nhịp tim nghỉ và thời lượng Workout. Website không thể đánh thức app iPhone; background scheduling của iOS không có SLA.

## Daily intelligence trên iPhone

- App tính tiến độ Steps, Active Energy và Sleep theo mục tiêu lưu trong `UserDefaults` của chính iPhone.
- Điểm ngày là trung bình của các chỉ số đang có, giới hạn mỗi tiến độ ở 100%; chỉ số thiếu không bị thay bằng 0.
- Insight ưu tiên thiếu ngủ trước thiếu vận động cuối ngày và không được xem là tư vấn y tế.
- Mục tiêu, điểm và insight là dữ liệu dẫn xuất cục bộ, không được thêm vào payload Supabase.
- Environment score, dữ liệu phòng và timeline hợp nhất vẫn thuộc dashboard web; app HealthKit không đọc trực tiếp telemetry ESP32.

## Ranh giới hệ thống

- HealthKit chỉ được đọc trên iPhone.
- App không ghi dữ liệu HealthKit.
- Steps và Active Energy dùng thống kê HealthKit đã hợp nhất nguồn, không upload raw samples.
- Sleep chỉ upload bản tổng hợp theo ngày gồm giờ ngủ, giờ thức và phút thực ngủ; không upload raw sleep stages.
- REM/Deep được cộng theo giấc ngủ được chọn; HRV SDNN và nhịp tim nghỉ dùng thống kê ngày, không upload raw heart-rate stream.
- Workout giữ từng mốc bắt đầu/kết thúc và thời lượng nhưng không gửi loại Workout, GPS hay raw samples.
- Room telemetry hiện tại vẫn công khai và không được dùng làm nơi lưu Health.
- Health tables chỉ đọc được bởi chính tài khoản đã đăng nhập.
- Mọi write đi qua `health-ingest`; app không có quyền DML trực tiếp.
- Service credential chỉ tồn tại trong môi trường Edge Function.

## Luồng đồng bộ

1. Người dùng đăng nhập Supabase.
2. Người dùng đọc giải thích và xin quyền cho các nhóm HealthKit được allowlist.
3. Người dùng bật consent upload riêng; mặc định consent này tắt.
4. App chạy thống kê giờ cho Steps/Active Energy, thống kê ngày cho HRV/nhịp tim nghỉ và sample query cho Sleep/Workout trong cửa sổ reconcile.
5. Mỗi bucket có định danh deterministic và được lưu vào SwiftData trước khi gửi.
6. Uploader gửi từng request idempotent, xóa hàng đợi chỉ sau ACK.
7. Edge Function xác thực JWT, tự lấy user ID, validate payload và gọi RPC transaction.
8. Supabase upsert bucket, cập nhật sync status và lưu batch ledger/hash.

## Cơ hội đồng bộ

- Nhấn **Đồng bộ ngay**.
- App launch/foreground.
- `HKObserverQuery` báo một trong các loại dữ liệu HealthKit đã cấp quyền thay đổi.
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
