# Milestones LongOS Sync

## M1 — Steps vertical slice

- Backend private, Auth/RLS, batch ledger và Edge Function.
- App iPhone thủ công: login, quyền Steps, consent cloud, query, queue, upload, ACK.
- Observer/background delivery và bounded reconciliation.
- Acceptance trên iPhone thật, offline/retry và isolation user A/B/anon.

## M1.3 — LongOS web

Thêm card Steps có đăng nhập và freshness. Web chỉ đọc authenticated summary; không thể đánh thức app. Chưa triển khai trong app folder này vì dashboard hiện tại phải được thay đổi ở root sau khi M1 backend/device đã PASS.

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
