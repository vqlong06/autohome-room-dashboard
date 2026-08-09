# Quyền riêng tư LongOS Sync

LongOS Sync phục vụ phân tích sức khỏe/thể chất cá nhân và mối liên hệ với không gian sống. Đây không phải thiết bị y tế và không đưa ra chẩn đoán.

## Hai consent tách biệt

1. **HealthKit:** cho phép app đọc Steps trên thiết bị.
2. **Cloud sync:** cho phép truyền bucket Steps đã tổng hợp đến Supabase để đồng bộ giữa app và LongOS.

Cloud sync mặc định tắt. Cấp quyền HealthKit không tự bật upload.

## Dữ liệu M1

Upload:

- tổng số Steps theo bucket giờ;
- thời gian UTC và ngữ cảnh múi giờ/ngày địa phương;
- installation ID ngẫu nhiên và trạng thái đồng bộ.

Không upload raw step samples, GPS, ECG, thuốc, clinical records, mật khẩu, token hay dữ liệu phòng trong payload Health.

## Mục đích và lưu giữ

Dữ liệu chỉ dùng cho chức năng cá nhân LongOS, không dùng quảng cáo, bán dữ liệu hoặc huấn luyện mô hình chung. Thời hạn lưu phải được cấu hình và công bố trước production.

Thu hồi quyền HealthKit chỉ dừng việc đọc mới; nó không tự xóa dữ liệu cloud. App cung cấp thao tác **Xóa toàn bộ dữ liệu Health trên cloud** riêng. Đăng xuất không đồng nghĩa với xóa dữ liệu.

## Bảo mật

- Session và installation ID lưu trong Keychain.
- Queue local được bảo vệ bằng iOS Data Protection.
- Health values không được ghi vào log, analytics, notification hay crash breadcrumb.
- Health tables không có anonymous access.
- `service_role` không bao giờ nằm trong app/web/repository.
