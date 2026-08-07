# LongOS Sync

LongOS Sync là ứng dụng iPhone riêng của LongOS. Bản đầu tiên chỉ đọc **Steps** từ HealthKit, lưu hàng đợi trên máy và đồng bộ các bucket thống kê lên vùng dữ liệu Supabase riêng tư.

Ứng dụng không ghi vào Apple Health, không có watchOS target và không dùng các bảng phòng công khai `room_latest` / `room_readings`.

## Trạng thái milestone

Milestone M1 gồm:

- SwiftUI, iOS 17+ và SwiftData.
- Đăng nhập Supabase bằng email/password.
- Xin duy nhất quyền đọc Steps.
- Consent HealthKit và consent upload Supabase là hai bước độc lập.
- Tính bucket Steps theo giờ bằng `HKStatisticsCollectionQuery`.
- Reconcile hôm nay và 7 ngày gần nhất.
- Hàng đợi offline, retry có giới hạn và upload idempotent.
- `HKObserverQuery`, HealthKit background delivery và `BGAppRefreshTask` theo kiểu best-effort.
- Hiển thị Steps hôm nay, lần sync cuối, hàng đợi và lỗi gần nhất.
- Backend Auth/RLS/Edge Function nằm trong thư mục `Supabase/` của app.

Không thuộc M1: Sleep, nhịp tim, HRV, workout, Activity Rings, ECG, thuốc, hồ sơ bệnh án và watchOS.

## Cấu trúc

```text
LongOS Sync/
├── LongOSSync.xcodeproj/
├── LongOSSync/                 # App SwiftUI
├── LongOSSyncCore/             # Logic thuần Swift dùng chung
├── LongOSSyncCoreTests/
├── Config/
├── Docs/
├── Supabase/
├── Package.swift               # Chạy test core khi chưa có Xcode
└── Tests/
```

Mọi file liên quan LongOS Sync đều nằm trong thư mục này. Dashboard và firmware ở root repository không bị thay đổi.

## Cấu hình cục bộ

Sao chép file mẫu nhưng không commit file thật:

```bash
cd "/Users/voquoclong/Downloads/My projects/LongOS/LongOS Sync"
cp Config/Secrets.example.xcconfig Config/Secrets.xcconfig
```

Điền:

```text
LONGOS_SUPABASE_SCHEME = https
LONGOS_SUPABASE_HOST = <project-ref>.supabase.co
LONGOS_SUPABASE_PUBLISHABLE_KEY = sb_publishable_...
```

Publishable key có thể nằm trong app; lớp bảo vệ dữ liệu là Supabase Auth, Edge Function và RLS. Tuyệt đối không đưa `service_role`, secret key hoặc device token ESP32 vào app.

## Build

Máy cần Xcode đầy đủ với iOS SDK. Sau khi cài Xcode:

```bash
xcodebuild -list -project LongOSSync.xcodeproj
xcodebuild \
  -project LongOSSync.xcodeproj \
  -scheme LongOSSync \
  -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO \
  build
```

HealthKit và background delivery phải kiểm thử trên iPhone thật. Simulator không phải acceptance environment cho luồng này.

Trong Xcode:

1. Chọn target **LongOSSync**.
2. Chọn Apple Account/Personal Team và bundle identifier riêng.
3. Giữ Automatic Signing.
4. Kiểm tra capability HealthKit và Background Delivery.
5. Cài lên iPhone, đăng nhập rồi cấp quyền Steps.
6. Bật consent cloud riêng trong app trước khi nhấn **Đồng bộ ngay**.

## Test không cần Xcode

```bash
npm ci
npm run check
```

`swift test` cũng chạy bộ unit test core khi SwiftPM/Command Line Tools trên máy đồng bộ phiên bản. Nếu SwiftPM báo lỗi link `PackageDescription`, dùng `npm run check` để type-check core và parse toàn source, rồi chạy unit test bằng scheme Xcode sau khi cài Xcode đầy đủ.

## Deploy backend

Đọc [Supabase/README.md](Supabase/README.md). Migration và Edge Functions chưa tự động chạm production; phải review và deploy vào đúng project Supabase trước khi app có thể upload.

## Quyền riêng tư

HealthKit authorization không đồng nghĩa với đồng ý upload. Cloud sync mặc định tắt. App chỉ upload Steps sau khi người dùng đọc disclosure và bật consent riêng. Xem [Docs/PRIVACY.md](Docs/PRIVACY.md).
