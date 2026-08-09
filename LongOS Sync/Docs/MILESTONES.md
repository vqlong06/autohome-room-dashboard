# Milestones LongOS Sync

## M1 — Steps vertical slice

- Backend private, Auth/RLS, batch ledger và Edge Function.
- App iPhone thủ công: login, quyền Steps, consent cloud, query, queue, upload, ACK.
- Observer/background delivery và bounded reconciliation.
- Acceptance trên iPhone thật, offline/retry và isolation user A/B/anon.

## M1.3 — LongOS web

- Dashboard root có card Steps, đăng nhập Supabase và freshness.
- Web chỉ đọc bucket/status của chính user bằng JWT và RLS; room telemetry ESP32 vẫn là luồng riêng.
- Session chỉ nằm trong `sessionStorage`, mật khẩu không được lưu và không có service credential trong web.
- Website không thể đánh thức app; LongOS Sync trên iPhone vẫn chịu trách nhiệm đọc HealthKit và upload.
- App 0.2 mở dashboard cloud bằng URL HTTPS cấu hình sẵn, nhưng không chuyển session, token hoặc mật khẩu sang website.

## M2 — Sleep × Room

- Xin `sleepAnalysis` riêng khi bật tính năng.
- `HKAnchoredObjectQuery`, UUID/tombstone và anchor versioned.
- Ghép sleep interval với nhiệt độ/độ ẩm/phòng.
- Morning Climate Brief sau 14–30 đêm hợp lệ.
- Chỉ nói tương quan, không tuyên bố nguyên nhân hay chẩn đoán.

## M3 — Recovery

Resting HR, HRV SDNN và respiratory rate dạng daily baseline; không upload raw heart-rate stream.

## Deferred

Activity Rings, workout, VO₂ max, SpO₂, weight/BMI và watchOS.

## Excluded sớm

ECG, thuốc, clinical records và Clinical Health Records capability.
