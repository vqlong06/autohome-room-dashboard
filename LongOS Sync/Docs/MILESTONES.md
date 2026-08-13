# Milestones LongOS Sync

## M1 — Steps vertical slice

- Backend private, Auth/RLS, batch ledger và Edge Function.
- App iPhone thủ công: login, quyền Steps, consent cloud, query, queue, upload, ACK.
- Observer/background delivery và bounded reconciliation.
- Acceptance trên iPhone thật, offline/retry và isolation user A/B/anon.

## M1.3 — LongOS web

- Dashboard root có Steps, Active Energy, Sleep, daily intelligence, timeline và freshness.
- Web chỉ đọc bucket/status của chính user bằng JWT và RLS; room telemetry ESP32 vẫn là luồng riêng.
- Phiên đăng nhập được giữ cục bộ trên trình duyệt đến khi đăng xuất; mật khẩu không được lưu và không có service credential trong web.
- Website không thể đánh thức app; LongOS Sync trên iPhone vẫn chịu trách nhiệm đọc HealthKit và upload.
- App 0.2 mở dashboard cloud bằng URL HTTPS cấu hình sẵn, nhưng không chuyển session, token hoặc mật khẩu sang website.

## M1.4 — Sleep + Active Energy (hoàn thành)

- Đọc `sleepAnalysis` và `activeEnergyBurned` từ HealthKit.
- Đồng bộ bản tóm tắt Sleep theo ngày và bucket kcal theo giờ.
- App 0.4 có điểm ngày, tiến độ và mục tiêu cục bộ cho ba chỉ số.

## M2 — Sleep × Room

- Ghép sleep interval với nhiệt độ/độ ẩm/phòng.
- Morning Climate Brief sau 14–30 đêm hợp lệ.
- Chỉ nói tương quan, không tuyên bố nguyên nhân hay chẩn đoán.

## M1.5 — Recovery + Workout summaries (hoàn thành)

App 0.5 đồng bộ Resting HR, HRV SDNN, REM/Deep và thời lượng Workout. Web chỉ tạo recovery score khi có cả hai recovery metric và tối thiểu 7 ngày nền cá nhân; không upload raw heart-rate stream.

## M3 — Recovery mở rộng

Respiratory rate, baseline bền vững hơn và kiểm thử xu hướng nhiều tuần.

## Deferred

Activity Rings, Workout route/type/energy chi tiết, VO₂ max, SpO₂, weight/BMI và watchOS.

## Excluded sớm

ECG, thuốc, clinical records và Clinical Health Records capability.
