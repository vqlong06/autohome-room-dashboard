# LongOS

LongOS là dashboard cảm biến phòng chạy trên ESP32. Web hiển thị nhiệt độ/độ ẩm realtime, trạng thái phòng, min/max hôm nay, trend 1 giờ, lịch sử cloud, so sánh nhiệt độ trung bình hôm nay với hôm qua, tuần này với tuần trước, và tháng này với tháng trước.

## Cần chuẩn bị

- ESP32 DevKit
- Module GY-SHT30 / SHT30-D
- 4 dây jumper
- Cáp USB data
- Nguồn USB 5V để cắm chạy liên tục

## Đi dây

ESP32 dùng chân I2C mặc định:

```text
GY-SHT30  ->  ESP32
VCC       ->  3V3
GND       ->  GND
SDA       ->  GPIO 21
SCL       ->  GPIO 22
```

Nên để cảm biến cách ESP32 một đoạn ngắn để nhiệt từ ESP32 không làm sai số.

## Mở LongOS trên Mac

Mở trực tiếp:

```text
public/index.html
```

Hoặc chạy localhost:

```bash
cd "/Users/voquoclong/Downloads/My projects/LongOS"
python3 -m http.server 9876
```

Sau đó mở:

```text
http://127.0.0.1:9876/public/index.html
```

Mặc định trang preview sẽ hiện trạng thái chưa có dữ liệu vì không có ESP32 ở phía sau. Nếu chỉ muốn test giao diện bằng dữ liệu giả, mở:

```text
http://127.0.0.1:9876/public/index.html?demo=1
```

`index_v1.html` chỉ là trang tương thích để chuyển URL cũ sang dashboard hiện tại. Mã dashboard cũ vẫn nằm trong Git history, không được phục vụ như một ứng dụng riêng. Các file `public/index_v*.html` nếu có chỉ là snapshot cục bộ đã bị Git bỏ qua; không đưa chúng vào bản deploy.

## Upload bằng Arduino IDE

1. Cài ESP32 board package trong Arduino IDE.
2. Điền cấu hình riêng trong `include/secrets.h` (file này đã được `.gitignore`).
3. Không đưa `include/secrets.h` lên GitHub; chỉ public `include/secrets.example.h`.
4. Chọn board ESP32 và port.
5. Upload.
6. Mở Serial Monitor ở `115200` baud.
7. Mở URL được in ra bằng phone hoặc Mac.

Nếu để `WIFI_SSID` rỗng, ESP32 sẽ phát Wi-Fi riêng:

```text
SSID: LongOS-Sensor
Password: giá trị LONGOS_AP_PASSWORD trong include/secrets.h
URL: http://192.168.4.1
```

Khi ESP32 đã kết nối Wi-Fi nhà, có thể thử mở `http://longos-sensor.local`. Cấu hình mới dùng các macro `LONGOS_*`; firmware vẫn chấp nhận các macro `AUTOHOME_*` trong file `include/secrets.h` cũ để nâng cấp không bị gián đoạn.

## Smoke test ESP32 thật

Khi ESP32 đang online cùng mạng với máy và máy có Node.js 18 trở lên, chạy kiểm tra nhanh dashboard, favicon, Apple touch icon và hai endpoint `/health`, `/api/readings`:

```bash
node tools/test-device-smoke.mjs
```

Script mặc định dùng `http://longos-sensor.local`, tự lấy phiên bản mong đợi từ `APP_VERSION` trong `src/main.cpp`, có timeout cho từng request, kiểm tra schema phản hồi và xác nhận nội dung web nhúng khớp các file nguồn. Để yêu cầu cả SHT30 và Supabase hoạt động thành công:

```bash
node tools/test-device-smoke.mjs --require-sensor --require-cloud
```

Nếu mDNS không phân giải được, truyền IP được in trong Serial Monitor:

```bash
node tools/test-device-smoke.mjs --url http://192.168.1.50 --require-sensor --require-cloud
```

Xem toàn bộ tùy chọn bằng `node tools/test-device-smoke.mjs --help`.

## CI và phát hành GitHub Pages

Mỗi lần push hoặc mở pull request, workflow `LongOS CI` tự kiểm tra branding, migration, release allowlist và build firmware ESP32 bằng cấu hình mẫu. CI không đọc `include/secrets.h` thật; bản build CI chỉ dùng để xác nhận biên dịch, không dùng để nạp lên thiết bị.

Kiểm tra tương đương trên máy:

```bash
npm ci
npm run test:supabase-semantic
node tools/test-brand-migration.mjs
node tools/test-cloud-health.mjs
node tools/test-pages-smoke-integration.mjs
node tools/test-release-pipeline.mjs
node tools/test-supabase-security.mjs
test -e include/secrets.h || install -m 600 include/secrets.example.h include/secrets.h
pio run -e esp32dev
```

`test:supabase-semantic` chạy các migration thật trong một database PGlite tạm thời, không kết nối Supabase production và không đọc secrets hoặc telemetry production. Gate kiểm tra riêng bootstrap fresh hiện tại, sau đó dựng nguyên trạng legacy từ commit `f589e75` rồi xác nhận hardening giữ nguyên fingerprint toàn bộ telemetry; hành vi RLS/ACL, token đúng/sai, giới hạn `main-room`, trigger `updated_at` và luồng cron; contract verifier đúng 21 trường (kết quả `PASS` cùng 20 kiểm tra boolean); đủ 20 mutation bảo mật độc lập phải làm từng trường verifier chuyển sang `false` và mỗi mutation phải rollback sạch về `PASS`. Gate cũng xác nhận hardening chạy lặp lại an toàn, emergency rollback vẫn chặn token sai, không đổi telemetry và có thể harden lại sau rollback.

PGlite chỉ là semantic gate PostgreSQL chạy cục bộ. Test dùng shim cho catalog và hàm điều khiển `pg_cron`, nên không mô phỏng scheduler/extension `pg_cron` thật; nó cũng không mô phỏng lớp PostgREST, schema exposure, HTTP error mapping hoặc tranh chấp từ nhiều kết nối đồng thời. Vì vậy kết quả có thẩm quyền cho production vẫn là `supabase/verify_security_hardening.sql` trả đủ 21 trường hợp lệ trên database thật, kết hợp REST smoke ở bản Pages đang live; semantic gate không thay thế hai kiểm tra đó.

Lệnh `install` chỉ tạo cấu hình mẫu khi `include/secrets.h` chưa tồn tại, không ghi đè cấu hình thật. Workflow `Deploy LongOS Pages` sao chép đúng allowlist 7 file public vào một thư mục staging riêng; `src/`, `include/`, `web/`, SQL, secrets và snapshot cục bộ không nằm trong Pages artifact. Workflow chỉ deploy từ branch `main`.

Sau mỗi deployment, một job không có quyền deploy chạy kiểm tra contract: đối chiếu build marker, manifest, favicon, Apple touch icon, `.nojekyll`, xác nhận source/secrets trả `404`, thử quyền đọc ẩn danh của hai bảng Supabase và xác nhận schema riêng `longos_private` không được public qua REST. Kiểm tra này không yêu cầu ESP32 đang online nên một lần mất điện hoặc mất Wi-Fi không làm deployment hợp lệ bị báo hỏng. Có thể chạy lại cùng kiểm tra contract với bản đã deploy bằng:

```bash
node tools/test-pages-smoke.mjs --require-cloud
```

Workflow `LongOS Production Smoke` chạy kiểm tra health đầy đủ trên phiên bản đang live mỗi 15 phút, lệch vào phút 07/22/37/52 để tránh giờ tròn đông tải, và có thể chạy thủ công trong tab **Actions**. Mỗi lượt thử lại tối đa 3 lần khi có lỗi mạng tạm thời. Ngoài toàn bộ contract ở trên, job yêu cầu heartbeat `room_latest` không cũ quá 3 phút, mẫu history mới nhất không cũ quá 20 phút và các trạng thái ESP32, Wi-Fi, SHT30 đều online. Job ngay sau deployment vẫn chỉ kiểm tra contract và đối chiếu build marker chính xác với commit vừa phát hành; lỗi thiết bị sẽ do production health báo riêng.

Chạy production health tương đương trên máy:

```bash
node tools/test-pages-smoke.mjs --require-cloud-health
```

`--require-cloud-health` ngầm bật `--require-cloud`. Có thể đổi ngưỡng bằng CLI `--latest-max-age-ms`, `--history-max-age-ms` hoặc hai biến môi trường `LONGOS_CLOUD_LATEST_MAX_AGE_MS`, `LONGOS_CLOUD_HISTORY_MAX_AGE_MS`; mặc định lần lượt là `180000` và `1200000` mili giây. Ví dụ:

```bash
LONGOS_CLOUD_LATEST_MAX_AGE_MS=240000 \
LONGOS_CLOUD_HISTORY_MAX_AGE_MS=1500000 \
node tools/test-pages-smoke.mjs --require-cloud-health
```

Cả hai chế độ chỉ đọc dữ liệu và không cần GitHub secret. Log chỉ ghi kết quả contract, trạng thái cùng độ trễ heartbeat/history; script không in nhiệt độ, độ ẩm, khóa Supabase hoặc nội dung telemetry thô.

**Lưu ý riêng tư:** GitHub Pages và dữ liệu `main-room` theo cấu hình Supabase hiện tại đều công khai cho người có URL. Nếu dữ liệu phòng cần riêng tư, chưa bật Pages cho đến khi bổ sung đăng nhập và RLS tương ứng.

Thiết lập một lần trên GitHub sau khi workflow đã được merge vào `main`:

1. Mở repository, vào **Settings → Pages**.
2. Trong **Build and deployment → Source**, chọn **GitHub Actions**.
3. Merge hoặc push vào `main`; theo dõi workflow `Deploy LongOS Pages` trong tab **Actions**.
4. Sau lần chạy đầu, có thể vào **Settings → Environments → github-pages** và giới hạn deployment branch là `main`.
5. Khi workflow hoàn tất, mở URL Pages được hiển thị trong job `Deploy site`.

Với remote hiện tại, URL dự kiến là `https://vqlong06.github.io/autohome-room-dashboard/`.

Không chọn `Deploy from a branch` với thư mục root vì cách đó có thể public cả mã nguồn dự án. Nếu chạy workflow thủ công, hãy chọn branch `main`.

## Lịch sử và so sánh

- ESP32 đồng bộ giờ bằng NTP khi kết nối Wi-Fi.
- Dashboard có heartbeat riêng cho ESP32. Nếu trang đã mở sẵn mà ESP32 mất nguồn/mất Wi-Fi, lần polling kế tiếp sẽ hiện `ESP32 offline`.
- Trạng thái ESP32 và SHT30 được tách riêng: ESP32 có thể `Online` trong khi cảm biến `Offline`.
- Thống kê lưu trong flash của ESP32 tối đa 21 ngày.
- Min/max hôm nay được cập nhật từ dữ liệu cảm biến trong ngày.
- Trend 1 giờ được tính từ mẫu lưu trong RAM theo từng phút, nên sau khi ESP32 mới khởi động cần khoảng 50-60 phút để có trend thật.
- So sánh dùng nhiệt độ trung bình:
  - Hôm nay so với hôm qua
  - Tuần này so với cùng số ngày của tuần trước
  - Tháng này so với cùng khoảng thời gian của tháng trước khi có bảng Supabase history
- Nếu chưa đủ dữ liệu, dashboard sẽ hiện trạng thái đang tích lũy.
- Nếu ESP32 không đọc được SHT30, API trả `temperatureC: null`, `humidity: null` và dashboard hiện trạng thái chưa có dữ liệu.

## Xem ngoài mạng bằng Supabase Free

Dashboard có chế độ cloud để xem khi không ở cùng Wi-Fi. ESP32 gửi heartbeat lên Supabase mỗi 30 giây vào `room_latest`, đồng thời ghi lịch sử thưa hơn mỗi 10 phút vào `room_readings` để giữ dữ liệu nhẹ và vẫn đủ so sánh ngày/tuần/tháng.

Dashboard Pages đọc `room_latest` định kỳ 30 giây khi tab hiển thị, tương ứng nhịp heartbeat của ESP32, và đọc ngay khi người dùng quay lại tab; tùy chọn làm mới 1 giây vẫn được giữ cho dashboard chạy trực tiếp trong mạng LAN và chế độ demo. Request có timeout 8 giây, các lượt đọc số mới nhất không chạy chồng nhau, polling tạm dừng khi tab bị ẩn và lịch sử được tải ở nền sau khi số mới nhất đã hiển thị.

1. Mở Supabase project và vào SQL Editor.
2. Cài mới: chạy `supabase/room_latest.sql`, rồi `supabase/add_history.sql`. Hai file tạo helper xác thực trong schema `longos_private`; `add_history.sql` chỉ lên lịch dọn history quá 90 ngày, không tạo snapshot trùng với firmware. Không thêm schema `longos_private` vào **Exposed schemas** trong Supabase API Settings.
3. Với database đang chạy từ bản cũ: giữ ESP32 hoạt động và chạy toàn bộ `supabase/security_hardening.sql` một lần. Migration nằm trong một transaction, giữ nguyên device-token hash và dữ liệu, khóa RPC cũ, tắt job `autohome-snapshot` bị trùng nguồn ghi, đồng thời giữ hoặc khôi phục `autohome-cleanup` 90 ngày.
4. Với database đang chạy từ bản cũ (đã có `pg_cron`), chạy `supabase/verify_security_hardening.sql`; cột `longos_security_result` phải là `PASS`. Sau đó chờ 30–60 giây để xác nhận heartbeat cloud tiếp tục cập nhật và tối đa 10–11 phút để thấy một mẫu history mới từ firmware.
5. Firmware `longos-sensor-2026-08-01.3` hiện tại không cần flash lại cho migration này. Chỉ upload firmware nếu board còn chạy bản cũ chưa tự ghi `room_readings`.
6. Bật workflow Pages theo mục **CI và phát hành GitHub Pages**; workflow sẽ deploy đủ HTML, manifest và icon từ `public/`.
7. Mở dashboard cloud bằng:

```text
https://vqlong06.github.io/autohome-room-dashboard/?source=cloud
```

Khi deploy `public/index.html` lên static hosting miễn phí như GitHub Pages, trang sẽ tự dùng Supabase nếu hostname không phải IP nội bộ. Dashboard không yêu cầu mật khẩu; bất kỳ ai có URL đều đọc được dữ liệu `main-room`. Quyền ghi và cập nhật vẫn chỉ dành cho ESP32 có device token hợp lệ. Nếu `updated_at` trên cloud cũ hơn 2 phút, dashboard sẽ báo `ESP32 offline`.

Với database đã bật mã dashboard từ bản trước, chạy `supabase/enable_public_dashboard_read.sql` một lần để mở quyền đọc công khai. `include/secrets.h` vẫn bị Git bỏ qua và không được upload công khai.

History chỉ bắt đầu có dữ liệu từ lúc ESP32 chạy firmware mới và bảng `room_readings` đã được tạo. Firmware là nguồn ghi history chính, mỗi 10 phút; không chạy `supabase/snapshot_room_readings.sql` cùng firmware hiện tại vì job 5 phút trong file đó là fallback cho firmware legacy và sẽ tạo nguồn ghi thứ hai. So sánh hôm qua/tuần trước/tháng trước sẽ hiện `Cần thêm dữ liệu lịch sử` cho đến khi đủ mẫu.

Nếu `security_hardening.sql` báo lỗi, transaction sẽ không commit: dừng lại và giữ nguyên toàn bộ thông báo lỗi để kiểm tra, không chạy riêng từng đoạn. Nếu SQL Editor còn báo `current transaction is aborted`, chạy riêng `rollback;` một lần để đóng transaction lỗi. Chỉ dùng `supabase/security_hardening_rollback.sql` nếu migration đã báo thành công nhưng `room_latest.updated_at` ngừng tăng dù ESP32 và Wi-Fi vẫn khỏe. RPC cũ trả `401`, `403` hoặc `404` sau migration là kết quả mong muốn, không phải lý do rollback. File rollback vẫn giữ RLS, không mở lại RPC public, không xóa telemetry và không tự bật lại cron snapshot. Sau rollback, không chạy lại verifier chuẩn (nó được thiết kế để báo `FAIL` khi private helper đã được gỡ); hãy xác nhận heartbeat tăng trở lại rồi gửi toàn bộ kết quả rollback để xử lý tiếp.

Các script hardening cũng đổi default privilege của role `postgres` trong database LongOS: mọi function tạo mới sau đó đều cần được cấp `EXECUTE` tường minh. Quy tắc này áp dụng cho function mới ở mọi schema do `postgres` tạo (không đổi quyền function đã tồn tại); emergency rollback cố ý không mở lại mặc định public này.

Dashboard cũng hiển thị nhiệt độ nội bộ của chip ESP32. Chỉ số này dùng để theo dõi board có nóng bất thường không, không dùng thay cho nhiệt độ phòng vì bị ảnh hưởng bởi Wi-Fi, CPU và vị trí đặt board.

Nếu đã tạo bảng trước khi firmware có nhiệt độ chip ESP32, chạy thêm:

```text
supabase/add_chip_temperature.sql
```

Firmware xác thực HTTPS bằng CA thay vì `setInsecure()`. Chứng thư gốc hiện dùng nằm trong `include/supabase_ca.h`; nên kiểm tra lại chuỗi chứng thư Supabase khi bảo trì định kỳ hoặc khi Serial báo lỗi TLS sau một thay đổi hạ tầng phía Supabase.

Nếu Wi-Fi nhà chưa sẵn sàng lúc khởi động hoặc bị rớt sau đó, ESP32 giữ AP fallback và tự thử kết nối lại mỗi 30 giây. Khi Wi-Fi nhà trở lại, board tự thoát AP, khởi động lại mDNS/NTP và gửi heartbeat cloud ngay.

## API

```text
GET /api/readings
```

Ví dụ:

```json
{
  "temperatureC": 27.1,
  "humidity": 62,
  "deviceOnline": true,
  "wifiConnected": true,
  "wifiMode": "STA",
  "wifiRssi": -54,
  "chipTemperatureC": 48.5,
  "lastSensorOkMs": 12000,
  "sensorOnline": true,
  "source": "SHT30",
  "uptimeMs": 12345,
  "ip": "192.168.1.50",
  "cloudUploadOk": true,
  "cloudHistoryOk": true,
  "stats": {
    "timeSynced": true,
    "daysStored": 2,
    "todayAvgC": 27.2,
    "yesterdayAvgC": 26.8,
    "currentWeekAvgC": 27.2,
    "previousWeekAvgC": 26.9,
    "todayMinC": 26.4,
    "todayMaxC": 28.1,
    "todayMinHumidity": 55,
    "todayMaxHumidity": 70,
    "temperatureTrend1hC": 0.3,
    "humidityTrend1h": -2,
    "todaySamples": 600,
    "yesterdaySamples": 86400,
    "currentWeekSamples": 600,
    "previousWeekSamples": 600
  }
}
```

Khi chưa cắm hoặc không đọc được cảm biến:

```json
{
  "temperatureC": null,
  "humidity": null,
  "deviceOnline": true,
  "wifiConnected": true,
  "wifiMode": "STA",
  "wifiRssi": -54,
  "chipTemperatureC": 48.5,
  "lastSensorOkMs": null,
  "sensorOnline": false,
  "source": "No data",
  "uptimeMs": 12345,
  "ip": "192.168.1.50",
  "stats": {
    "timeSynced": true,
    "daysStored": 0,
    "todayAvgC": null,
    "yesterdayAvgC": null,
    "currentWeekAvgC": null,
    "previousWeekAvgC": null,
    "todayMinC": null,
    "todayMaxC": null,
    "todayMinHumidity": null,
    "todayMaxHumidity": null,
    "temperatureTrend1hC": null,
    "humidityTrend1h": null,
    "todaySamples": 0,
    "yesterdaySamples": 0,
    "currentWeekSamples": 0,
    "previousWeekSamples": 0
  }
}
```

## Đồng bộ web vào firmware

Sau khi sửa bất kỳ file nào trong thư mục `web/`, chạy:

```bash
node tools/embed-web.mjs
```

Script này gzip HTML và SVG, nhúng thêm Apple touch icon, rồi sinh lại `include/web_assets.h` để ESP32 serve đúng các file trong `web/`. File header là nội dung sinh tự động, không sửa thủ công.
