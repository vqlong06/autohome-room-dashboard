# LongOS Sync

LongOS Sync là ứng dụng iPhone riêng của LongOS. App đọc **Steps**, **Active Energy** và **Sleep** từ HealthKit, lưu hàng đợi trên máy rồi đồng bộ dữ liệu tổng hợp lên vùng Supabase riêng tư.

Ứng dụng không ghi vào Apple Health, không có watchOS target và không dùng các bảng phòng công khai `room_latest` / `room_readings`.

## Trạng thái milestone

Phiên bản 0.3 gồm:

- SwiftUI, iOS 17+ và SwiftData.
- Đăng nhập Supabase bằng email/password.
- Xin quyền chỉ đọc Steps, Active Energy và Sleep Analysis.
- Consent HealthKit và consent upload Supabase là hai bước độc lập.
- Tính Steps và Active Energy theo bucket giờ bằng `HKStatisticsCollectionQuery`.
- Gộp các khoảng đang ngủ bị chồng lấn từ HealthKit thành một bản tóm tắt mỗi ngày: giờ ngủ, giờ thức và tổng phút thực ngủ; không upload raw sleep stages.
- Reconcile hôm nay và 7 ngày gần nhất.
- Hàng đợi offline, retry có giới hạn và upload idempotent.
- `HKObserverQuery`, HealthKit background delivery và `BGAppRefreshTask` theo kiểu best-effort.
- Hiển thị Steps, kcal vận động, giấc ngủ gần nhất, lần sync cuối, hàng đợi và lỗi gần nhất.
- Backend Auth/RLS/Edge Function nằm trong thư mục `Supabase/` của app.

Chưa thuộc phạm vi: nhịp tim, HRV, workout chi tiết, Activity Rings, ECG, thuốc, hồ sơ bệnh án và watchOS.

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

Backend và app iPhone nằm trong thư mục này. Dashboard root hiển thị Steps, kcal vận động và giấc ngủ đã đồng bộ cạnh dữ liệu ESP32; firmware không đọc hoặc lưu dữ liệu HealthKit.

Từ bản 0.2, app có card **LongOS trên web** để mở dashboard cloud. Safari yêu cầu đăng nhập riêng bằng cùng tài khoản Supabase; app không nhúng session, token hoặc mật khẩu vào URL.

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
5. Cài lên iPhone, đăng nhập rồi cấp quyền Steps, Active Energy và Sleep.
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

HealthKit authorization không đồng nghĩa với đồng ý upload. Cloud sync mặc định tắt. App chỉ upload dữ liệu HealthKit tổng hợp sau khi người dùng đọc disclosure và bật consent riêng. Xem [Docs/PRIVACY.md](Docs/PRIVACY.md).
