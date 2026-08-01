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
Password: giá trị AUTOHOME_AP_PASSWORD trong include/secrets.h
URL: http://192.168.4.1
```

Khi ESP32 đã kết nối Wi-Fi nhà, có thể thử mở `http://longos-sensor.local`. Tên macro `AUTOHOME_AP_PASSWORD` được giữ lại để firmware mới tiếp tục dùng được file `include/secrets.h` hiện tại.

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

1. Mở Supabase project và vào SQL Editor.
2. Cài mới: chạy `supabase/room_latest.sql`, rồi `supabase/add_history.sql`.
3. Với database đang chạy từ bản cũ: chạy một lần `supabase/security_hardening.sql` để thêm migration còn thiếu và bảo vệ quyền ghi bằng token ESP32.
4. Upload lại firmware cho ESP32 sau khi SQL chạy thành công.
5. Upload `public/index.html` lên GitHub Pages.
6. Mở dashboard cloud bằng:

```text
public/index.html?source=cloud
```

Khi deploy `public/index.html` lên static hosting miễn phí như GitHub Pages, trang sẽ tự dùng Supabase nếu hostname không phải IP nội bộ. Dashboard không yêu cầu mật khẩu; bất kỳ ai có URL đều đọc được dữ liệu `main-room`. Quyền ghi và cập nhật vẫn chỉ dành cho ESP32 có device token hợp lệ. Nếu `updated_at` trên cloud cũ hơn 2 phút, dashboard sẽ báo `ESP32 offline`.

Với database đã bật mã dashboard từ bản trước, chạy `supabase/enable_public_dashboard_read.sql` một lần để mở quyền đọc công khai. `include/secrets.h` vẫn bị Git bỏ qua và không được upload công khai.

History chỉ bắt đầu có dữ liệu từ lúc ESP32 chạy firmware mới và bảng `room_readings` đã được tạo. So sánh hôm qua/tuần trước/tháng trước sẽ hiện `Cần thêm dữ liệu lịch sử` cho đến khi đủ mẫu.

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

Sau khi sửa `web/index.html`, chạy:

```bash
node tools/embed-web.mjs
```

Script này nhúng lại giao diện web vào `src/main.cpp` để ESP32 serve đúng bản mới.
