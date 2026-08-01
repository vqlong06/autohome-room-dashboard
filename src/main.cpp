#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <Wire.h>
#include <Preferences.h>
#include <limits.h>
#include <math.h>
#include <time.h>
#include "secrets.h"
#include "supabase_ca.h"

const char *WIFI_SSID = AUTOHOME_WIFI_SSID;
const char *WIFI_PASSWORD = AUTOHOME_WIFI_PASSWORD;

const char *MDNS_NAME = "autohome-sensor";
const char *AP_SSID = "AutoHome-Sensor";
const char *AP_PASSWORD = AUTOHOME_AP_PASSWORD;
const char *TIME_ZONE = "ICT-7";
const char *APP_VERSION = "autohome-status-2026-07-10.1";
const char *SUPABASE_URL = AUTOHOME_SUPABASE_URL;
const char *SUPABASE_PUBLISHABLE_KEY = AUTOHOME_SUPABASE_PUBLISHABLE_KEY;
const char *SUPABASE_ROOM_ID = AUTOHOME_SUPABASE_ROOM_ID;
const char *SUPABASE_DEVICE_TOKEN = AUTOHOME_SUPABASE_DEVICE_TOKEN;

const uint8_t SHT3X_ADDRESS = 0x44;
const int SDA_PIN = 21;
const int SCL_PIN = 22;
const unsigned long SAMPLE_INTERVAL_MS = 1000;
const unsigned long CLOUD_UPLOAD_INTERVAL_MS = 30UL * 1000UL;
const unsigned long CLOUD_HISTORY_INTERVAL_MS = 10UL * 60UL * 1000UL;
const unsigned long WIFI_TIMEOUT_MS = 15000;
const unsigned long WIFI_RETRY_INTERVAL_MS = 30UL * 1000UL;
const unsigned long HISTORY_SAVE_INTERVAL_MS = 15UL * 60UL * 1000UL;
const unsigned long TIME_CHECK_INTERVAL_MS = 60UL * 1000UL;
const unsigned long TREND_SAMPLE_INTERVAL_MS = 60UL * 1000UL;
const unsigned long TREND_HORIZON_MS = 60UL * 60UL * 1000UL;
const unsigned long TREND_MIN_AGE_MS = 50UL * 60UL * 1000UL;
const int HISTORY_DAYS = 21;
const int TREND_POINTS = 61;

WebServer server(80);
Preferences preferences;

struct Reading {
  float temperatureC = NAN;
  float humidity = NAN;
  bool sensorOnline = false;
  unsigned long updatedAtMs = 0;
};

Reading lastReading;
unsigned long lastSampleMs = 0;
unsigned long lastCloudUploadMs = 0;
unsigned long lastCloudHistoryMs = 0;
unsigned long lastHistorySaveMs = 0;
unsigned long lastTimeCheckMs = 0;
uint64_t lastSensorOkMs = 0;
uint64_t uptimeHighMs = 0;
uint32_t uptimeLastLowMs = 0;
unsigned long lastWifiRetryMs = 0;
bool lastCloudUploadOk = false;
int lastCloudStatusCode = 0;
bool lastCloudHistoryOk = false;
int lastCloudHistoryStatusCode = 0;
bool historyDirty = false;
bool historyReady = false;
bool timeReady = false;
bool accessPointStarted = false;
bool mdnsStarted = false;
bool timeSyncConfigured = false;
bool stationWasConnected = false;

struct DayStat {
  uint32_t day = 0;
  double tempSum = 0;
  double humiditySum = 0;
  uint32_t samples = 0;
  float tempMin = NAN;
  float tempMax = NAN;
  float humidityMin = NAN;
  float humidityMax = NAN;
};

struct Average {
  float value = NAN;
  uint32_t samples = 0;
  uint8_t days = 0;
};

DayStat history[HISTORY_DAYS];

struct TrendPoint {
  unsigned long timestampMs = 0;
  float temperatureC = NAN;
  float humidity = NAN;
};

TrendPoint trendPoints[TREND_POINTS];
int trendIndex = 0;
unsigned long lastTrendSampleMs = 0;

bool supabaseConfigured();
bool stationConnected();
bool accessPointActive();
uint64_t extendedUptimeMs();

const char INDEX_HTML[] PROGMEM = R"HTML(
<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Cảm biến phòng AutoHome</title>
  <meta name="theme-color" content="#0b1420">
  <meta name="application-name" content="AutoHome">
  <meta name="apple-mobile-web-app-title" content="AutoHome">
  <link rel="icon" type="image/svg+xml" href="./favicon.svg?v=20260528">
  <link rel="apple-touch-icon" sizes="180x180" href="./apple-touch-icon.png?v=20260528">
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f6f7f9;
      --panel: #ffffff;
      --text: #171a21;
      --muted: #667085;
      --line: #d9dee7;
      --accent: #0f8b8d;
      --warm: #c26a2d;
      --cool: #2d7fb8;
      --shadow: rgba(16, 24, 40, 0.08);
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #111318;
        --panel: #181b22;
        --text: #f1f4f8;
        --muted: #a6afbd;
        --line: #303641;
        --accent: #39b8b5;
        --warm: #dc8b49;
        --cool: #62a8dc;
        --shadow: rgba(0, 0, 0, 0.25);
      }
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0;
    }

    .app {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }

    .dashboard {
      width: min(960px, 100%);
    }

    .topbar {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 18px;
    }

    h1 {
      margin: 0 0 6px;
      font-size: 28px;
      line-height: 1.12;
      font-weight: 760;
    }

    .subtitle {
      margin: 0;
      color: var(--muted);
      font-size: 15px;
    }

    .status {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      min-width: 170px;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.4;
      text-align: right;
    }

    .dot {
      width: 10px;
      height: 10px;
      flex: 0 0 auto;
      border-radius: 50%;
      background: var(--warm);
      box-shadow: 0 0 0 4px color-mix(in srgb, var(--warm), transparent 82%);
    }

    .dot.live {
      background: var(--accent);
      box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent), transparent 82%);
    }

    .grid,
    .device-grid,
    .compare-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }

    .metric-card,
    .comfort-card,
    .device-card,
    .compare-card,
    .history-card,
    .details {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: 0 18px 40px var(--shadow);
    }

    .device-grid {
      grid-template-columns: repeat(5, minmax(0, 1fr));
      margin-bottom: 12px;
    }

    .device-card {
      min-height: 86px;
      padding: 14px 16px;
    }

    .device-label {
      margin: 0 0 8px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
    }

    .device-value {
      display: block;
      color: var(--muted);
      font-size: 18px;
      line-height: 1.2;
      font-weight: 780;
      overflow-wrap: anywhere;
    }

    .device-value.ok {
      color: var(--accent);
    }

    .device-value.warn {
      color: var(--warm);
    }

    .device-value.bad {
      color: #d9534f;
    }

    .device-copy {
      margin: 5px 0 0;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.35;
      overflow-wrap: anywhere;
    }

    .comfort-card {
      min-height: 152px;
      margin-bottom: 12px;
      padding: 20px;
      display: grid;
      grid-template-columns: minmax(0, 1.2fr) minmax(280px, 0.8fr);
      gap: 18px;
      align-items: center;
    }

    .comfort-kicker {
      margin: 0 0 6px;
      color: var(--muted);
      font-size: 13px;
      font-weight: 680;
    }

    .comfort-title {
      margin: 0;
      font-size: 42px;
      line-height: 1;
      font-weight: 800;
    }

    .comfort-title.good {
      color: var(--accent);
    }

    .comfort-title.warm {
      color: var(--warm);
    }

    .comfort-title.cool {
      color: var(--cool);
    }

    .comfort-copy {
      margin: 10px 0 0;
      color: var(--muted);
      font-size: 15px;
      line-height: 1.45;
    }

    .comfort-facts {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }

    .pill {
      min-height: 52px;
      padding: 10px 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: color-mix(in srgb, var(--panel), var(--bg) 35%);
    }

    .pill-label,
    .stat-label {
      display: block;
      margin-bottom: 3px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 680;
      text-transform: uppercase;
    }

    .pill-value,
    .stat-value {
      display: block;
      font-size: 15px;
      line-height: 1.3;
      font-weight: 700;
      overflow-wrap: anywhere;
    }

    .metric-card {
      min-height: 300px;
      padding: 20px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 18px;
    }

    .metric-label,
    .compare-label {
      margin: 0;
      color: var(--muted);
      font-size: 14px;
      font-weight: 650;
    }

    .value-row {
      display: flex;
      align-items: baseline;
      gap: 8px;
      min-width: 0;
    }

    .value {
      font-size: 58px;
      line-height: 1;
      font-weight: 780;
      white-space: nowrap;
    }

    .unit {
      color: var(--muted);
      font-size: 19px;
      font-weight: 650;
    }

    .quick-stats {
      margin-top: 18px;
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
    }

    .quick-stat {
      min-height: 58px;
      padding: 9px 10px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: color-mix(in srgb, var(--panel), var(--bg) 35%);
    }

    .meter {
      height: 7px;
      width: 100%;
      overflow: hidden;
      border-radius: 4px;
      background: color-mix(in srgb, var(--line), transparent 15%);
    }

    .meter > span {
      display: block;
      width: 0;
      height: 100%;
      border-radius: 4px;
      background: var(--accent);
      transition: width 220ms ease;
    }

    .meter > span.warm {
      background: var(--warm);
    }

    canvas {
      width: 100%;
      height: 72px;
      display: block;
    }

    .compare-grid {
      margin-top: 12px;
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .compare-card {
      min-height: 138px;
      padding: 18px 20px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 12px;
    }

    .delta {
      display: inline-flex;
      align-items: baseline;
      min-height: 44px;
      color: var(--muted);
      font-size: 34px;
      line-height: 1;
      font-weight: 780;
      white-space: nowrap;
    }

    .delta.up {
      color: var(--warm);
    }

    .delta.down {
      color: var(--cool);
    }

    .delta.flat {
      color: var(--accent);
    }

    .compare-copy {
      margin: 0;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.45;
      overflow-wrap: anywhere;
    }

    .history-card {
      margin-top: 12px;
      padding: 18px 20px;
    }

    .history-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 12px;
    }

    .range-tabs {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: color-mix(in srgb, var(--panel), var(--bg) 35%);
    }

    .range-tab {
      appearance: none;
      min-width: 58px;
      height: 30px;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: var(--muted);
      font: inherit;
      font-size: 12px;
      font-weight: 750;
      cursor: pointer;
    }

    .range-tab.active {
      background: var(--accent);
      color: #ffffff;
    }

    .history-legend {
      display: flex;
      align-items: center;
      gap: 14px;
      margin-top: 10px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
    }

    .legend-item {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .legend-line {
      width: 18px;
      height: 3px;
      border-radius: 999px;
      background: var(--accent);
    }

    .legend-line.warm {
      background: var(--warm);
    }

    #historyChart {
      height: 130px;
    }

    .details {
      margin-top: 12px;
      padding: 16px 18px;
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
    }

    .detail-label {
      margin: 0 0 3px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 680;
      text-transform: uppercase;
    }

    .detail-value {
      margin: 0;
      font-size: 15px;
      font-weight: 650;
      overflow-wrap: anywhere;
    }

    @media (max-width: 720px) {
      .app {
        align-items: flex-start;
        padding: 16px;
      }

      .topbar {
        flex-direction: column;
      }

      h1 {
        font-size: 24px;
      }

      .status {
        justify-content: flex-start;
        min-width: 0;
        text-align: left;
      }

      .comfort-card {
        grid-template-columns: 1fr;
      }

      .comfort-title {
        font-size: 34px;
      }

      .grid,
      .device-grid,
      .compare-grid,
      .details {
        grid-template-columns: 1fr;
      }

      .metric-card {
        min-height: 300px;
      }

      .value {
        font-size: 48px;
      }

      .quick-stats {
        grid-template-columns: 1fr;
      }

      .history-head {
        flex-direction: column;
      }

      .range-tabs {
        width: 100%;
      }

      .range-tab {
        flex: 1;
      }

      .delta {
        font-size: 30px;
      }
    }
  </style>
</head>
<body>
  <main class="app">
    <section class="dashboard" aria-label="Bảng điều khiển cảm biến phòng">
      <div class="topbar">
        <div>
          <h1>Phòng AutoHome</h1>
          <p class="subtitle">Nhiệt độ và độ ẩm theo thời gian thực</p>
        </div>
        <div class="status">
          <span id="statusDot" class="dot" aria-hidden="true"></span>
          <span id="statusText">Chưa có dữ liệu</span>
        </div>
      </div>

      <section class="device-grid" aria-label="Trạng thái thiết bị">
        <article class="device-card">
          <p class="device-label">ESP32</p>
          <span id="deviceStatus" class="device-value">Đang kiểm tra</span>
          <p id="deviceDetail" class="device-copy">Chưa nhận heartbeat</p>
        </article>
        <article class="device-card">
          <p class="device-label">Chip ESP32</p>
          <span id="chipTemp" class="device-value">--.-°C</span>
          <p id="chipDetail" class="device-copy">Nhiệt nội bộ</p>
        </article>
        <article class="device-card">
          <p class="device-label">Cảm biến</p>
          <span id="sensorStatus" class="device-value">Đang kiểm tra</span>
          <p id="sensorDetail" class="device-copy">SHT30</p>
        </article>
        <article class="device-card">
          <p class="device-label">Wi-Fi ESP32</p>
          <span id="wifiStatus" class="device-value">--</span>
          <p id="wifiDetail" class="device-copy">--</p>
        </article>
        <article class="device-card">
          <p class="device-label">Lần nhận</p>
          <span id="lastSeen" class="device-value">--</span>
          <p id="uptime" class="device-copy">--</p>
        </article>
      </section>

      <section class="comfort-card" aria-label="Trạng thái phòng">
        <div>
          <p class="comfort-kicker">Trạng thái phòng</p>
          <p id="comfortTitle" class="comfort-title">Đang đo</p>
          <p id="comfortCopy" class="comfort-copy">Đang lấy dữ liệu từ cảm biến</p>
        </div>
        <div class="comfort-facts">
          <div class="pill">
            <span class="pill-label">Nhiệt độ</span>
            <span id="comfortTemp" class="pill-value">--.-°C</span>
          </div>
          <div class="pill">
            <span class="pill-label">Độ ẩm</span>
            <span id="comfortHumidity" class="pill-value">--%</span>
          </div>
          <div class="pill">
            <span class="pill-label">Nhiệt 1 giờ</span>
            <span id="comfortTempTrend" class="pill-value">--</span>
          </div>
          <div class="pill">
            <span class="pill-label">Ẩm 1 giờ</span>
            <span id="comfortHumidityTrend" class="pill-value">--</span>
          </div>
        </div>
      </section>

      <div class="grid">
        <article class="metric-card">
          <div>
            <p class="metric-label">Nhiệt độ</p>
            <div class="value-row">
              <span id="temperature" class="value">--.-</span>
              <span class="unit">&deg;C</span>
            </div>
            <div class="quick-stats">
              <div class="quick-stat">
                <span class="stat-label">Thấp nhất</span>
                <span id="tempMinToday" class="stat-value">--</span>
              </div>
              <div class="quick-stat">
                <span class="stat-label">Cao nhất</span>
                <span id="tempMaxToday" class="stat-value">--</span>
              </div>
              <div class="quick-stat">
                <span class="stat-label">1 giờ</span>
                <span id="tempTrend1h" class="stat-value">--</span>
              </div>
            </div>
          </div>
          <div>
            <div class="meter" aria-hidden="true"><span id="tempMeter" class="warm"></span></div>
            <canvas id="tempChart" width="400" height="72"></canvas>
          </div>
        </article>

        <article class="metric-card">
          <div>
            <p class="metric-label">Độ ẩm</p>
            <div class="value-row">
              <span id="humidity" class="value">--</span>
              <span class="unit">%</span>
            </div>
            <div class="quick-stats">
              <div class="quick-stat">
                <span class="stat-label">Thấp nhất</span>
                <span id="humidityMinToday" class="stat-value">--</span>
              </div>
              <div class="quick-stat">
                <span class="stat-label">Cao nhất</span>
                <span id="humidityMaxToday" class="stat-value">--</span>
              </div>
              <div class="quick-stat">
                <span class="stat-label">1 giờ</span>
                <span id="humidityTrend1h" class="stat-value">--</span>
              </div>
            </div>
          </div>
          <div>
            <div class="meter" aria-hidden="true"><span id="humidityMeter"></span></div>
            <canvas id="humidityChart" width="400" height="72"></canvas>
          </div>
        </article>
      </div>

      <section class="compare-grid" aria-label="So sánh nhiệt độ">
        <article class="compare-card">
          <p class="compare-label">Hôm nay so với hôm qua</p>
          <span id="dayDelta" class="delta">--</span>
          <p id="daySummary" class="compare-copy">Đang tích lũy dữ liệu</p>
        </article>

        <article class="compare-card">
          <p class="compare-label">Tuần này so với tuần trước</p>
          <span id="weekDelta" class="delta">--</span>
          <p id="weekSummary" class="compare-copy">Đang tích lũy dữ liệu</p>
        </article>

        <article class="compare-card">
          <p class="compare-label">Tháng này so với tháng trước</p>
          <span id="monthDelta" class="delta">--</span>
          <p id="monthSummary" class="compare-copy">Đang tích lũy dữ liệu</p>
        </article>
      </section>

      <section class="history-card" aria-label="Lịch sử nhiệt độ và độ ẩm">
        <div class="history-head">
          <div>
            <p class="compare-label">Lịch sử</p>
            <p id="historySummary" class="compare-copy">Đang tải dữ liệu</p>
          </div>
          <div class="range-tabs" aria-label="Chọn khoảng lịch sử">
            <button class="range-tab active" type="button" data-range="day">24h</button>
            <button class="range-tab" type="button" data-range="week">7 ngày</button>
            <button class="range-tab" type="button" data-range="month">30 ngày</button>
          </div>
        </div>
        <canvas id="historyChart" width="860" height="130"></canvas>
        <div class="history-legend" aria-hidden="true">
          <span class="legend-item"><span class="legend-line warm"></span>Nhiệt độ</span>
          <span class="legend-item"><span class="legend-line"></span>Độ ẩm</span>
        </div>
      </section>

      <section class="details" aria-label="Chi tiết cảm biến">
        <div>
          <p class="detail-label">Cập nhật</p>
          <p id="updatedAt" class="detail-value">--:--:--</p>
        </div>
        <div>
          <p class="detail-label">Nguồn</p>
          <p id="source" class="detail-value">Chưa có dữ liệu</p>
        </div>
        <div>
          <p class="detail-label">Lịch sử</p>
          <p id="history" class="detail-value">--</p>
        </div>
        <div>
          <p class="detail-label">Bản</p>
          <p id="appVersion" class="detail-value">--</p>
        </div>
      </section>
    </section>
  </main>

  <script>
    const SUPABASE_URL = 'https://ucgbvsmxljilmgrdfazk.supabase.co';
    const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_HRYudnWYxKH7VKEqJMGVXQ_FjR311MO';
    const SUPABASE_ROOM_ID = 'main-room';
    const CLOUD_STALE_MS = 2 * 60 * 1000;
    const CLOUD_HISTORY_REFRESH_MS = 60 * 1000;
    const CLOUD_ACCESS_STORAGE_KEY = 'autohome.cloudAccessToken.v1';
    const HISTORY_PAGE_SIZE = 1000;
    const HISTORY_INITIAL_LIMIT = 30000;
    const HISTORY_INCREMENTAL_LIMIT = 8000;
    const HISTORY_MAX_POINTS = 32000;
    const MS_HOUR = 60 * 60 * 1000;
    const MS_DAY = 24 * MS_HOUR;
    const params = new URLSearchParams(location.search);

    function isLocalDashboardHost(hostname) {
      return hostname === 'localhost'
        || hostname === '127.0.0.1'
        || hostname.endsWith('.local')
        || hostname.startsWith('192.168.')
        || hostname.startsWith('10.')
        || /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);
    }

    const state = {
      points: [],
      historyPoints: [],
      historyRange: 'day',
      historyAttemptedAt: 0,
      historyLoadedAt: 0,
      historyError: false,
      cloudAccessPrompted: false,
      latestReadingForHistory: null,
      demoStart: Date.now(),
      demoMode: params.get('demo') === '1',
      cloudMode: params.get('source') === 'cloud'
        || params.get('cloud') === '1'
        || (!params.get('source') && !isLocalDashboardHost(location.hostname))
    };

    if (params.get('reset_access') === '1') {
      try { localStorage.removeItem(CLOUD_ACCESS_STORAGE_KEY); } catch (error) {}
    }

    function readCloudAccessToken() {
      try { return (localStorage.getItem(CLOUD_ACCESS_STORAGE_KEY) || '').trim(); }
      catch (error) { return ''; }
    }

    function getCloudAccessToken() {
      const stored = readCloudAccessToken();
      if (stored || state.cloudAccessPrompted || !state.cloudMode || state.demoMode) return stored;
      state.cloudAccessPrompted = true;
      const entered = window.prompt('Nhập mã truy cập cloud AutoHome (chỉ cần nhập một lần trên thiết bị này):');
      const token = (entered || '').trim();
      if (token) {
        try { localStorage.setItem(CLOUD_ACCESS_STORAGE_KEY, token); } catch (error) {}
      }
      return token;
    }

    function cloudHeaders() {
      const token = getCloudAccessToken();
      if (!token) return null;
      return {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
        'x-dashboard-token': token
      };
    }

    const els = {
      statusDot: document.getElementById('statusDot'),
      statusText: document.getElementById('statusText'),
      deviceStatus: document.getElementById('deviceStatus'),
      deviceDetail: document.getElementById('deviceDetail'),
      chipTemp: document.getElementById('chipTemp'),
      chipDetail: document.getElementById('chipDetail'),
      sensorStatus: document.getElementById('sensorStatus'),
      sensorDetail: document.getElementById('sensorDetail'),
      wifiStatus: document.getElementById('wifiStatus'),
      wifiDetail: document.getElementById('wifiDetail'),
      lastSeen: document.getElementById('lastSeen'),
      uptime: document.getElementById('uptime'),
      comfortTitle: document.getElementById('comfortTitle'),
      comfortCopy: document.getElementById('comfortCopy'),
      comfortTemp: document.getElementById('comfortTemp'),
      comfortHumidity: document.getElementById('comfortHumidity'),
      comfortTempTrend: document.getElementById('comfortTempTrend'),
      comfortHumidityTrend: document.getElementById('comfortHumidityTrend'),
      temperature: document.getElementById('temperature'),
      humidity: document.getElementById('humidity'),
      tempMinToday: document.getElementById('tempMinToday'),
      tempMaxToday: document.getElementById('tempMaxToday'),
      tempTrend1h: document.getElementById('tempTrend1h'),
      humidityMinToday: document.getElementById('humidityMinToday'),
      humidityMaxToday: document.getElementById('humidityMaxToday'),
      humidityTrend1h: document.getElementById('humidityTrend1h'),
      tempMeter: document.getElementById('tempMeter'),
      humidityMeter: document.getElementById('humidityMeter'),
      tempChart: document.getElementById('tempChart'),
      humidityChart: document.getElementById('humidityChart'),
      dayDelta: document.getElementById('dayDelta'),
      daySummary: document.getElementById('daySummary'),
      weekDelta: document.getElementById('weekDelta'),
      weekSummary: document.getElementById('weekSummary'),
      monthDelta: document.getElementById('monthDelta'),
      monthSummary: document.getElementById('monthSummary'),
      historySummary: document.getElementById('historySummary'),
      historyChart: document.getElementById('historyChart'),
      rangeTabs: Array.from(document.querySelectorAll('[data-range]')),
      updatedAt: document.getElementById('updatedAt'),
      source: document.getElementById('source'),
      history: document.getElementById('history'),
      appVersion: document.getElementById('appVersion')
    };

    function ensureDemoHistory() {
      if (state.historyPoints.length > 0) return;

      const now = Date.now();
      const start = now - 35 * MS_DAY;
      const step = 2 * MS_HOUR;
      const points = [];

      for (let timestamp = start; timestamp <= now; timestamp += step) {
        const hours = (timestamp - start) / MS_HOUR;
        const dailyWave = Math.sin((hours / 24) * Math.PI * 2 - 0.9);
        const slowWave = Math.sin(hours / 73);
        const temperatureC = 26.4 + dailyWave * 1.1 + slowWave * 0.7;
        const humidity = 60 - dailyWave * 5 + Math.cos(hours / 57) * 4;
        points.push({
          recordedAtMs: timestamp,
          temperatureC,
          humidity,
          chipTemperatureC: 49 + Math.sin(hours / 37) * 2,
          sensorOnline: true
        });
      }

      state.historyPoints = points;
      state.historyLoadedAt = now;
      state.historyError = false;
    }

    function makeDemoStats(temperatureC, humidity) {
      const seconds = (Date.now() - state.demoStart) / 1000;
      const todayAvgC = temperatureC - 0.18 + Math.sin(seconds / 41) * 0.08;
      const yesterdayAvgC = todayAvgC - 0.55 + Math.sin(seconds / 63) * 0.05;
      const currentWeekAvgC = temperatureC - 0.32 + Math.sin(seconds / 77) * 0.06;
      const previousWeekAvgC = currentWeekAvgC + 0.42 + Math.cos(seconds / 81) * 0.05;
      const currentMonthAvgC = temperatureC - 0.22 + Math.sin(seconds / 91) * 0.05;
      const previousMonthAvgC = currentMonthAvgC - 0.36 + Math.cos(seconds / 103) * 0.05;
      const temperatureTrend1hC = 0.35 + Math.sin(seconds / 31) * 0.12;
      const humidityTrend1h = -2 + Math.cos(seconds / 27) * 1.2;

      return {
        timeSynced: true,
        daysStored: 14,
        todayAvgC,
        yesterdayAvgC,
        currentWeekAvgC,
        previousWeekAvgC,
        currentMonthAvgC,
        previousMonthAvgC,
        todayMinC: Math.min(temperatureC - 1.1, todayAvgC - 0.6),
        todayMaxC: Math.max(temperatureC + 0.8, todayAvgC + 0.9),
        todayMinHumidity: Math.min(humidity - 7, 54),
        todayMaxHumidity: Math.max(humidity + 8, 68),
        temperatureTrend1hC,
        humidityTrend1h,
        todaySamples: 620,
        yesterdaySamples: 864,
        currentWeekSamples: 2480,
        previousWeekSamples: 2480,
        currentMonthSamples: 6200,
        previousMonthSamples: 6200
      };
    }

    function makeDemoReading() {
      ensureDemoHistory();

      const seconds = (Date.now() - state.demoStart) / 1000;
      const temperatureC = 27 + Math.sin(seconds / 34) * 0.7 + Math.sin(seconds / 9) * 0.16;
      const humidity = 61 + Math.sin(seconds / 43) * 4 + Math.cos(seconds / 17) * 0.9;

      return {
        appVersion: 'web-demo',
        deviceOnline: true,
        wifiConnected: true,
        wifiMode: 'STA',
        wifiRssi: -54,
        freeHeap: 210000,
        chipTemperatureC: 48.5 + Math.sin(seconds / 29) * 1.4,
        lastSensorOkMs: seconds * 1000,
        temperatureC,
        humidity,
        sensorOnline: true,
        source: 'Demo',
        uptimeMs: seconds * 1000,
        stats: makeDemoStats(temperatureC, humidity)
      };
    }

    function makeNoDataReading(source = 'No data', deviceOnline = false) {
      return {
        appVersion: 'web-local',
        cloudMode: state.cloudMode,
        deviceOnline,
        wifiConnected: false,
        wifiMode: '--',
        wifiRssi: null,
        freeHeap: null,
        chipTemperatureC: null,
        lastSensorOkMs: null,
        temperatureC: null,
        humidity: null,
        sensorOnline: false,
        source,
        uptimeMs: 0,
        stats: null
      };
    }

    function cloudReadingFromRow(row) {
      const updatedAtMs = Date.parse(row.updated_at);
      const cloudAgeMs = Number.isFinite(updatedAtMs) ? Date.now() - updatedAtMs : null;
      const fresh = Number.isFinite(cloudAgeMs) && cloudAgeMs <= CLOUD_STALE_MS;
      const deviceOnline = Boolean(row.device_online) && fresh;

      return {
        appVersion: row.app_version || 'cloud',
        cloudMode: true,
        updatedAtIso: row.updated_at,
        cloudAgeMs,
        deviceOnline,
        wifiConnected: deviceOnline && Boolean(row.wifi_connected),
        wifiMode: row.wifi_mode || '--',
        wifiRssi: row.wifi_rssi,
        freeHeap: row.free_heap,
        chipTemperatureC: deviceOnline ? row.chip_temperature_c : null,
        lastSensorOkMs: row.last_sensor_ok_ms,
        temperatureC: deviceOnline ? row.temperature_c : null,
        humidity: deviceOnline ? row.humidity : null,
        sensorOnline: deviceOnline && Boolean(row.sensor_online),
        source: deviceOnline ? (row.source || 'Supabase') : 'Cloud stale',
        uptimeMs: deviceOnline ? row.uptime_ms : 0,
        ip: row.local_ip,
        stats: null
      };
    }

    async function fetchCloudReading() {
      const endpoint = `${SUPABASE_URL}/rest/v1/room_latest?room_id=eq.${encodeURIComponent(SUPABASE_ROOM_ID)}&select=*&limit=1`;
      const headers = cloudHeaders();
      if (!headers) return makeNoDataReading('Cần mã truy cập cloud');

      try {
        const response = await fetch(endpoint, {
          cache: 'no-store',
          headers
        });
        if (!response.ok) throw new Error('Cloud endpoint unavailable');
        const rows = await response.json();
        if (!Array.isArray(rows) || rows.length === 0) {
          return makeNoDataReading('Mã cloud sai hoặc chưa có dữ liệu');
        }
        return cloudReadingFromRow(rows[0]);
      } catch (error) {
        return makeNoDataReading('Mất kết nối Supabase');
      }
    }

    function mapHistoryRows(rows) {
      return (Array.isArray(rows) ? rows : [])
        .map(row => ({
          recordedAtMs: Date.parse(row.recorded_at),
          temperatureC: finiteNumber(row.temperature_c),
          humidity: finiteNumber(row.humidity),
          chipTemperatureC: finiteNumber(row.chip_temperature_c),
          sensorOnline: Boolean(row.sensor_online)
        }))
        .filter(point => Number.isFinite(point.recordedAtMs));
    }

    async function fetchHistoryRows(url, headers) {
      const response = await fetch(url, { cache: 'no-store', headers });
      if (!response.ok) throw new Error('History endpoint unavailable');
      return mapHistoryRows(await response.json());
    }

    async function fetchHistoryRowsPaged(baseUrl, maxRows, headers) {
      const rows = [];
      for (let offset = 0; offset < maxRows; offset += HISTORY_PAGE_SIZE) {
        const limit = Math.min(HISTORY_PAGE_SIZE, maxRows - offset);
        const page = await fetchHistoryRows(`${baseUrl}&limit=${limit}&offset=${offset}`, headers);
        if (page.length === 0) break;
        rows.push(...page);
        if (page.length < limit) break;
      }
      return rows;
    }

    async function fetchCloudHistory() {
      const base = `${SUPABASE_URL}/rest/v1/room_readings?room_id=eq.${encodeURIComponent(SUPABASE_ROOM_ID)}`
        + '&select=recorded_at,temperature_c,humidity,chip_temperature_c,sensor_online';
      state.historyAttemptedAt = Date.now();
      const headers = cloudHeaders();
      if (!headers) {
        state.historyError = true;
        return;
      }

      try {
        if (state.historyPoints.length > 0) {
          const newestMs = state.historyPoints.reduce(
            (latest, point) => Math.max(latest, point.recordedAtMs),
            0
          );
          const sinceIso = new Date(newestMs).toISOString();
          const url = `${base}&recorded_at=gt.${encodeURIComponent(sinceIso)}&order=recorded_at.asc`;
          const fresh = (await fetchHistoryRowsPaged(url, HISTORY_INCREMENTAL_LIMIT, headers))
            .filter(point => point.recordedAtMs > newestMs);
          if (fresh.length) {
            state.historyPoints = state.historyPoints.concat(fresh).sort((a, b) => a.recordedAtMs - b.recordedAtMs);
            if (state.historyPoints.length > HISTORY_MAX_POINTS) {
              state.historyPoints = state.historyPoints.slice(-HISTORY_MAX_POINTS);
            }
          }
        } else {
          const startIso = startOfPreviousMonth(new Date()).toISOString();
          const url = `${base}&recorded_at=gte.${encodeURIComponent(startIso)}&order=recorded_at.desc`;
          const rows = await fetchHistoryRowsPaged(url, HISTORY_INITIAL_LIMIT, headers);
          rows.sort((a, b) => a.recordedAtMs - b.recordedAtMs);
          state.historyPoints = rows;
        }
        state.historyLoadedAt = Date.now();
        state.historyError = false;
      } catch (error) {
        state.historyError = true;
      }
    }

    async function maybeFetchCloudHistory(force = false) {
      if (state.demoMode || !state.cloudMode) return;
      const ageMs = Date.now() - state.historyAttemptedAt;
      if (!force && ageMs < CLOUD_HISTORY_REFRESH_MS) return;
      await fetchCloudHistory();
    }

    async function fetchReading() {
      if (state.demoMode) {
        return makeDemoReading();
      }

      if (state.cloudMode) {
        return fetchCloudReading();
      }

      try {
        const response = await fetch('/api/readings?ts=' + Date.now(), { cache: 'no-store' });
        if (!response.ok) throw new Error('No reading endpoint');
        const reading = await response.json();
        reading.deviceOnline = true;
        return reading;
      } catch (error) {
        return makeNoDataReading('Mất kết nối ESP32');
      }
    }

    function clamp(value, min, max) {
      return Math.max(min, Math.min(max, value));
    }

    function finiteNumber(value) {
      if (value === null || value === undefined || value === '') return null;
      const number = Number(value);
      return Number.isFinite(number) ? number : null;
    }

    function startOfDay(date) {
      return new Date(date.getFullYear(), date.getMonth(), date.getDate());
    }

    function startOfWeek(date) {
      const start = startOfDay(date);
      const daysSinceMonday = (start.getDay() + 6) % 7;
      start.setDate(start.getDate() - daysSinceMonday);
      return start;
    }

    function startOfMonth(date) {
      return new Date(date.getFullYear(), date.getMonth(), 1);
    }

    function startOfPreviousMonth(date) {
      return new Date(date.getFullYear(), date.getMonth() - 1, 1);
    }

    function addDays(date, days) {
      const next = new Date(date);
      next.setDate(next.getDate() + days);
      return next;
    }

    function liveHistoryPoint() {
      const point = state.latestReadingForHistory;
      if (!point
        || !Number.isFinite(point.recordedAtMs)
        || finiteNumber(point.temperatureC) === null
        || finiteNumber(point.humidity) === null) {
        return null;
      }
      return point;
    }

    function validStoredHistoryPoints() {
      return state.historyPoints
        .filter(point => Number.isFinite(point.recordedAtMs)
          && point.sensorOnline
          && finiteNumber(point.temperatureC) !== null
          && finiteNumber(point.humidity) !== null)
        .sort((a, b) => a.recordedAtMs - b.recordedAtMs);
    }

    function validHistoryPoints() {
      const points = validStoredHistoryPoints();
      const livePoint = liveHistoryPoint();

      if (livePoint) {
        const lastPoint = points[points.length - 1];
        if (!lastPoint || Math.abs(livePoint.recordedAtMs - lastPoint.recordedAtMs) > 30 * 1000) {
          points.push(livePoint);
        } else if (livePoint.recordedAtMs >= lastPoint.recordedAtMs) {
          points[points.length - 1] = livePoint;
        }
      }

      return points.sort((a, b) => a.recordedAtMs - b.recordedAtMs);
    }

    function averageFromHistory(points, startMs, endMs, key) {
      let sum = 0;
      let samples = 0;

      points.forEach(point => {
        const value = finiteNumber(point[key]);
        if (value === null || point.recordedAtMs < startMs || point.recordedAtMs >= endMs) return;
        sum += value;
        samples += 1;
      });

      return {
        value: samples > 0 ? sum / samples : null,
        samples
      };
    }

    function minMaxFromHistory(points, startMs, endMs, key) {
      let min = null;
      let max = null;

      points.forEach(point => {
        const value = finiteNumber(point[key]);
        if (value === null || point.recordedAtMs < startMs || point.recordedAtMs >= endMs) return;
        min = min === null ? value : Math.min(min, value);
        max = max === null ? value : Math.max(max, value);
      });

      return { min, max };
    }

    function trendFromHistory(points, key, horizonMs) {
      const values = points.filter(point => finiteNumber(point[key]) !== null);
      if (values.length < 2) return null;

      const latest = values[values.length - 1];
      const targetMs = latest.recordedAtMs - horizonMs;
      let reference = null;

      values.forEach(point => {
        if (point.recordedAtMs <= targetMs) reference = point;
      });

      if (!reference || latest.recordedAtMs - reference.recordedAtMs < horizonMs * 0.65) {
        return null;
      }

      return finiteNumber(latest[key]) - finiteNumber(reference[key]);
    }

    function countHistoryDays(points) {
      const days = new Set();
      points.forEach(point => days.add(startOfDay(new Date(point.recordedAtMs)).toISOString()));
      return days.size;
    }

    function buildHistoryStats() {
      const points = validHistoryPoints();
      if (points.length === 0) return null;
      const storedPoints = validStoredHistoryPoints();

      const now = new Date();
      const nowMs = now.getTime();
      const todayStart = startOfDay(now);
      const yesterdayStart = addDays(todayStart, -1);
      const weekStart = startOfWeek(now);
      const previousWeekStart = addDays(weekStart, -7);
      const monthStart = startOfMonth(now);
      const previousMonthStart = startOfPreviousMonth(now);

      const todayElapsedMs = nowMs - todayStart.getTime();
      const weekElapsedMs = nowMs - weekStart.getTime();
      const monthElapsedMs = nowMs - monthStart.getTime();
      const yesterdayEndMs = Math.min(yesterdayStart.getTime() + todayElapsedMs, todayStart.getTime());
      const previousWeekEndMs = Math.min(previousWeekStart.getTime() + weekElapsedMs, weekStart.getTime());
      const previousMonthEndMs = Math.min(previousMonthStart.getTime() + monthElapsedMs, monthStart.getTime());

      const todayAverage = averageFromHistory(points, todayStart.getTime(), nowMs, 'temperatureC');
      const yesterdayAverage = averageFromHistory(points, yesterdayStart.getTime(), yesterdayEndMs, 'temperatureC');
      const currentWeekAverage = averageFromHistory(points, weekStart.getTime(), nowMs, 'temperatureC');
      const previousWeekAverage = averageFromHistory(points, previousWeekStart.getTime(), previousWeekEndMs, 'temperatureC');
      const currentMonthAverage = averageFromHistory(points, monthStart.getTime(), nowMs, 'temperatureC');
      const previousMonthAverage = averageFromHistory(points, previousMonthStart.getTime(), previousMonthEndMs, 'temperatureC');
      const todayTemperature = minMaxFromHistory(points, todayStart.getTime(), nowMs, 'temperatureC');
      const todayHumidity = minMaxFromHistory(points, todayStart.getTime(), nowMs, 'humidity');

      return {
        timeSynced: true,
        daysStored: countHistoryDays(points),
        pointCount: points.length,
        storedPointCount: storedPoints.length,
        latestHistoryAtMs: points[points.length - 1].recordedAtMs,
        todayAvgC: todayAverage.value,
        yesterdayAvgC: yesterdayAverage.value,
        currentWeekAvgC: currentWeekAverage.value,
        previousWeekAvgC: previousWeekAverage.value,
        currentMonthAvgC: currentMonthAverage.value,
        previousMonthAvgC: previousMonthAverage.value,
        todayMinC: todayTemperature.min,
        todayMaxC: todayTemperature.max,
        todayMinHumidity: todayHumidity.min,
        todayMaxHumidity: todayHumidity.max,
        temperatureTrend1hC: trendFromHistory(points, 'temperatureC', MS_HOUR),
        humidityTrend1h: trendFromHistory(points, 'humidity', MS_HOUR),
        todaySamples: todayAverage.samples,
        yesterdaySamples: yesterdayAverage.samples,
        currentWeekSamples: currentWeekAverage.samples,
        previousWeekSamples: previousWeekAverage.samples,
        currentMonthSamples: currentMonthAverage.samples,
        previousMonthSamples: previousMonthAverage.samples
      };
    }

    function formatTemperature(value) {
      return finiteNumber(value) === null ? '--.-°C' : `${Number(value).toFixed(1)}°C`;
    }

    function formatHumidity(value) {
      return finiteNumber(value) === null ? '--%' : `${Math.round(Number(value))}%`;
    }

    function formatDelta(value) {
      const number = finiteNumber(value);
      if (number === null) return '--';
      const sign = number > 0 ? '+' : '';
      return `${sign}${number.toFixed(1)}°C`;
    }

    function formatHumidityDelta(value) {
      const number = finiteNumber(value);
      if (number === null) return '--';
      const rounded = Math.round(number);
      const sign = rounded > 0 ? '+' : '';
      return `${sign}${rounded}%`;
    }

    function formatUptime(ms) {
      const value = Number(ms);
      if (!Number.isFinite(value) || value <= 0) return '--';
      const totalSeconds = Math.floor(value / 1000);
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      if (hours > 0) return `${hours} giờ ${minutes} phút`;
      if (minutes > 0) return `${minutes} phút ${seconds} giây`;
      return `${seconds} giây`;
    }

    function formatSensorAge(reading) {
      const uptimeMs = Number(reading.uptimeMs);
      const lastSensorOkMs = Number(reading.lastSensorOkMs);
      if (!Number.isFinite(uptimeMs) || !Number.isFinite(lastSensorOkMs) || lastSensorOkMs <= 0) {
        return 'Chưa từng đọc được';
      }

      const ageMs = Math.max(0, uptimeMs - lastSensorOkMs);
      if (ageMs < 5000) return 'Vừa đọc được';
      return `Lần cuối ${formatUptime(ageMs)} trước`;
    }

    function formatCloudAge(reading) {
      const ageMs = Number(reading.cloudAgeMs);
      if (!Number.isFinite(ageMs) || ageMs < 0) return 'Chưa có heartbeat cloud';
      if (ageMs < 5000) return 'Cloud vừa cập nhật';
      return `Cloud ${formatUptime(ageMs)} trước`;
    }

    function formatRssi(rssi) {
      const value = Number(rssi);
      if (!Number.isFinite(value)) return '--';
      if (value >= -60) return `${value} dBm · mạnh`;
      if (value >= -72) return `${value} dBm · ổn`;
      return `${value} dBm · yếu`;
    }

    function chipTemperatureClass(value) {
      const temperature = finiteNumber(value);
      if (temperature === null) return 'device-value';
      if (temperature >= 85) return 'device-value bad';
      if (temperature >= 70) return 'device-value warn';
      return 'device-value ok';
    }

    function chipTemperatureDetail(value) {
      const temperature = finiteNumber(value);
      if (temperature === null) return 'Chưa có dữ liệu';
      if (temperature >= 85) return 'Chip rất nóng';
      if (temperature >= 70) return 'Chip hơi nóng';
      return 'Nhiệt nội bộ';
    }

    function comparisonClass(delta) {
      if (delta > 0.15) return 'up';
      if (delta < -0.15) return 'down';
      return 'flat';
    }

    function comfortState(temperature, humidity) {
      if (temperature >= 30) {
        return {
          title: 'Nóng',
          tone: 'warm',
          copy: 'Phòng đang nóng, nên bật điều hòa hoặc tăng quạt.'
        };
      }

      if (humidity >= 75) {
        return {
          title: 'Ẩm cao',
          tone: 'warm',
          copy: 'Độ ẩm cao, phòng có thể bí và dễ khó chịu.'
        };
      }

      if (temperature >= 28) {
        return {
          title: 'Hơi nóng',
          tone: 'warm',
          copy: 'Nhiệt độ hơi cao, theo dõi thêm nếu phòng có người.'
        };
      }

      if (humidity <= 40) {
        return {
          title: 'Hơi khô',
          tone: 'cool',
          copy: 'Độ ẩm thấp, có thể cần tạo ẩm nhẹ nếu thấy khô.'
        };
      }

      if (temperature >= 24 && temperature <= 28 && humidity >= 45 && humidity <= 70) {
        return {
          title: 'Dễ chịu',
          tone: 'good',
          copy: 'Nhiệt độ và độ ẩm đang ở vùng thoải mái.'
        };
      }

      return {
        title: 'Ổn định',
        tone: 'good',
        copy: 'Thông số phòng đang trong vùng ổn.'
      };
    }

    function updateMeters(reading) {
      const temperature = finiteNumber(reading.temperatureC);
      const humidity = finiteNumber(reading.humidity);
      const tempPercent = temperature === null ? 0 : clamp(((temperature - 16) / 20) * 100, 0, 100);
      els.tempMeter.style.width = tempPercent + '%';
      els.humidityMeter.style.width = humidity === null ? '0%' : clamp(humidity, 0, 100) + '%';
    }

    function resizeCanvas(canvas) {
      const ratio = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width * ratio));
      const height = Math.max(1, Math.floor(rect.height * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      return { width, height };
    }

    function drawChart(canvas, key, color) {
      const ctx = canvas.getContext('2d');
      const { width, height } = resizeCanvas(canvas);
      const points = state.points.slice(-60).map(point => point[key]);
      ctx.clearRect(0, 0, width, height);
      if (points.length < 2) return;

      const min = Math.min(...points);
      const max = Math.max(...points);
      const span = Math.max(0.8, max - min);
      const pad = 8 * (window.devicePixelRatio || 1);

      ctx.lineWidth = 2.5 * (window.devicePixelRatio || 1);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.strokeStyle = color;
      ctx.beginPath();

      points.forEach((value, index) => {
        const x = (index / (points.length - 1)) * (width - pad * 2) + pad;
        const y = height - pad - ((value - min) / span) * (height - pad * 2);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });

      ctx.stroke();
    }

    function selectedHistoryStartMs() {
      const now = Date.now();
      if (state.historyRange === 'month') return now - 30 * MS_DAY;
      if (state.historyRange === 'week') return now - 7 * MS_DAY;
      return now - MS_DAY;
    }

    function drawHistoryLine(ctx, points, key, color, width, height, pad) {
      const values = points
        .map(point => finiteNumber(point[key]))
        .filter(value => value !== null);
      if (points.length < 2 || values.length < 2) return;

      const min = Math.min(...values);
      const max = Math.max(...values);
      const span = Math.max(key === 'humidity' ? 8 : 1.2, max - min);
      const startMs = points[0].recordedAtMs;
      const endMs = points[points.length - 1].recordedAtMs;
      const rangeMs = Math.max(1, endMs - startMs);

      ctx.lineWidth = 2.4 * (window.devicePixelRatio || 1);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.strokeStyle = color;
      ctx.beginPath();

      let started = false;
      points.forEach(point => {
        const value = finiteNumber(point[key]);
        if (value === null) return;

        const x = ((point.recordedAtMs - startMs) / rangeMs) * (width - pad * 2) + pad;
        const y = height - pad - ((value - min) / span) * (height - pad * 2);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      });

      ctx.stroke();
    }

    function updateHistorySummary(stats) {
      if (state.historyError && (!stats || !stats.pointCount)) {
        els.historySummary.textContent = 'Chưa đọc được bảng lịch sử trên Supabase';
        return;
      }

      if (!stats || !stats.pointCount) {
        els.historySummary.textContent = 'Đang chờ ESP32 ghi mẫu lịch sử đầu tiên';
        return;
      }

      const latest = new Intl.DateTimeFormat('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: '2-digit'
      }).format(new Date(stats.latestHistoryAtMs));
      const storedPointCount = Number(stats.storedPointCount || 0);
      if (state.historyError) {
        els.historySummary.textContent = `Không đọc được cloud history · đang dùng dữ liệu hiện tại ${latest}`;
        return;
      }

      if (storedPointCount === 0) {
        els.historySummary.textContent = `Dữ liệu hiện tại · ${latest}`;
        return;
      }

      const liveSuffix = stats.pointCount > storedPointCount ? ' + hiện tại' : '';
      const lineSuffix = stats.pointCount < 2 ? ' · cần thêm mẫu để vẽ đường' : '';
      els.historySummary.textContent = `${storedPointCount} mẫu cloud${liveSuffix} · mới nhất ${latest}${lineSuffix}`;
    }

    function drawHistoryChart() {
      const canvas = els.historyChart;
      const ctx = canvas.getContext('2d');
      const { width, height } = resizeCanvas(canvas);
      const points = validHistoryPoints().filter(point => point.recordedAtMs >= selectedHistoryStartMs());

      ctx.clearRect(0, 0, width, height);
      if (points.length === 0) return;

      const pad = 12 * (window.devicePixelRatio || 1);
      if (points.length === 1) {
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--warm').trim();
        ctx.beginPath();
        ctx.arc(width / 2, height / 2, 5 * (window.devicePixelRatio || 1), 0, Math.PI * 2);
        ctx.fill();
        return;
      }

      drawHistoryLine(ctx, points, 'temperatureC', getComputedStyle(document.documentElement).getPropertyValue('--warm').trim(), width, height, pad);
      drawHistoryLine(ctx, points, 'humidity', getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(), width, height, pad);
    }

    function updateDeviceStatus(reading) {
      const deviceOnline = Boolean(reading.deviceOnline);
      const sensorOnline = Boolean(reading.sensorOnline);
      const wifiConnected = Boolean(reading.wifiConnected);

      els.deviceStatus.textContent = deviceOnline ? 'Online' : 'Offline';
      els.deviceStatus.className = `device-value ${deviceOnline ? 'ok' : 'bad'}`;
      els.deviceDetail.textContent = deviceOnline ? `Uptime ${formatUptime(reading.uptimeMs)}` : (reading.cloudMode ? formatCloudAge(reading) : 'Không nhận heartbeat');
      els.chipTemp.textContent = deviceOnline ? formatTemperature(reading.chipTemperatureC) : '--.-°C';
      els.chipTemp.className = deviceOnline ? chipTemperatureClass(reading.chipTemperatureC) : 'device-value bad';
      els.chipDetail.textContent = deviceOnline ? chipTemperatureDetail(reading.chipTemperatureC) : 'Không nhận heartbeat';

      els.sensorStatus.textContent = sensorOnline ? 'Online' : 'Offline';
      els.sensorStatus.className = `device-value ${sensorOnline ? 'ok' : 'warn'}`;
      els.sensorDetail.textContent = sensorOnline ? 'SHT30 đang gửi dữ liệu' : formatSensorAge(reading);

      if (!deviceOnline) {
        els.wifiStatus.textContent = '--';
        els.wifiStatus.className = 'device-value bad';
        els.wifiDetail.textContent = 'Không kết nối được ESP32';
        els.lastSeen.textContent = reading.cloudMode ? formatCloudAge(reading) : 'Mất kết nối';
        els.lastSeen.className = 'device-value bad';
        els.uptime.textContent = reading.cloudMode ? 'Dữ liệu cloud đã cũ' : 'Không có phản hồi';
        return;
      }

      els.wifiStatus.textContent = wifiConnected ? 'Đã kết nối' : (reading.wifiMode === 'AP' ? 'AP fallback' : 'Chưa rõ');
      els.wifiStatus.className = `device-value ${wifiConnected ? 'ok' : 'warn'}`;
      els.wifiDetail.textContent = wifiConnected ? formatRssi(reading.wifiRssi) : `Mode ${reading.wifiMode || '--'}`;
      els.lastSeen.textContent = reading.cloudMode ? formatCloudAge(reading) : 'Vừa xong';
      els.lastSeen.className = 'device-value ok';
      els.uptime.textContent = `ESP32 chạy ${formatUptime(reading.uptimeMs)}`;
    }

    function updateStatus(reading) {
      const deviceOnline = Boolean(reading.deviceOnline);
      const isLive = Boolean(reading.sensorOnline);
      const isDemo = reading.source === 'Demo';
      els.statusDot.classList.toggle('live', deviceOnline);
      els.statusText.textContent = !deviceOnline
        ? (reading.cloudMode ? 'ESP32 offline · cloud đã cũ' : 'ESP32 offline')
        : (isLive ? 'ESP32 online · SHT30 online' : (isDemo ? 'Dữ liệu demo' : 'ESP32 online · cảm biến offline'));
      els.source.textContent = !deviceOnline
        ? (reading.cloudMode ? 'Supabase' : 'Mất kết nối ESP32')
        : (reading.cloudMode ? (isLive ? 'Supabase · SHT30' : 'Supabase') : (isLive ? 'SHT30' : (isDemo ? 'Demo' : 'Chưa có cảm biến')));
    }

    function updateComfort(temperature, humidity, stats, reading = {}) {
      if (finiteNumber(temperature) === null || finiteNumber(humidity) === null) {
        const deviceOnline = Boolean(reading.deviceOnline);
        els.comfortTitle.textContent = deviceOnline ? 'Chưa có dữ liệu' : 'ESP32 offline';
        els.comfortTitle.className = 'comfort-title';
        els.comfortCopy.textContent = deviceOnline
          ? 'ESP32 chưa đọc được cảm biến SHT30. Kiểm tra dây VCC, GND, SDA, SCL.'
          : 'Không nhận được heartbeat từ ESP32. Kiểm tra nguồn 5V hoặc Wi-Fi.';
        els.comfortTemp.textContent = '--.-°C';
        els.comfortHumidity.textContent = '--%';
        els.comfortTempTrend.textContent = '--';
        els.comfortHumidityTrend.textContent = '--';
        return;
      }

      const state = comfortState(temperature, humidity);
      els.comfortTitle.textContent = state.title;
      els.comfortTitle.className = `comfort-title ${state.tone}`;
      els.comfortCopy.textContent = state.copy;
      els.comfortTemp.textContent = formatTemperature(temperature);
      els.comfortHumidity.textContent = formatHumidity(humidity);
      els.comfortTempTrend.textContent = formatDelta(stats?.temperatureTrend1hC);
      els.comfortHumidityTrend.textContent = formatHumidityDelta(stats?.humidityTrend1h);
    }

    function updateMetricStats(stats) {
      els.tempMinToday.textContent = formatTemperature(stats?.todayMinC);
      els.tempMaxToday.textContent = formatTemperature(stats?.todayMaxC);
      els.tempTrend1h.textContent = formatDelta(stats?.temperatureTrend1hC);
      els.humidityMinToday.textContent = formatHumidity(stats?.todayMinHumidity);
      els.humidityMaxToday.textContent = formatHumidity(stats?.todayMaxHumidity);
      els.humidityTrend1h.textContent = formatHumidityDelta(stats?.humidityTrend1h);
    }

    function updateComparison(deltaEl, summaryEl, current, previous, currentLabel, previousLabel) {
      if (current === null || previous === null) {
        deltaEl.textContent = '--';
        deltaEl.className = 'delta';
        summaryEl.textContent = 'Cần thêm dữ liệu lịch sử';
        return;
      }

      const delta = current - previous;
      deltaEl.textContent = formatDelta(delta);
      deltaEl.className = `delta ${comparisonClass(delta)}`;
      summaryEl.textContent = `${currentLabel} ${formatTemperature(current)} · ${previousLabel} ${formatTemperature(previous)}`;
    }

    function resetComparison(deltaEl, summaryEl, message) {
      deltaEl.textContent = '--';
      deltaEl.className = 'delta';
      summaryEl.textContent = message;
    }

    function updateStats(stats, reading = {}) {
      const historyStats = buildHistoryStats();
      const comparisonStats = historyStats || stats;
      const metricStats = reading.cloudMode ? historyStats : (stats || historyStats);

      updateHistorySummary(historyStats);
      drawHistoryChart();

      if (!comparisonStats) {
        resetComparison(els.dayDelta, els.daySummary, 'Chưa có dữ liệu cảm biến');
        resetComparison(els.weekDelta, els.weekSummary, 'Chưa có dữ liệu cảm biến');
        resetComparison(els.monthDelta, els.monthSummary, state.historyError ? 'Chưa tạo hoặc chưa đọc được bảng lịch sử' : 'Đang tích lũy dữ liệu');
        els.history.textContent = state.historyError ? 'Lỗi history' : 'Chưa sẵn sàng';
        updateMetricStats(null);
        return;
      }

      updateMetricStats(metricStats);

      if (comparisonStats.timeSynced === false) {
        resetComparison(els.dayDelta, els.daySummary, 'Đang chờ đồng bộ thời gian');
        resetComparison(els.weekDelta, els.weekSummary, 'Đang chờ đồng bộ thời gian');
        resetComparison(els.monthDelta, els.monthSummary, 'Đang chờ dữ liệu lịch sử cloud');
        els.history.textContent = 'Chưa sẵn sàng';
        return;
      }

      const todayAvgC = finiteNumber(comparisonStats.todayAvgC);
      const yesterdayAvgC = finiteNumber(comparisonStats.yesterdayAvgC);
      const currentWeekAvgC = finiteNumber(comparisonStats.currentWeekAvgC);
      const previousWeekAvgC = finiteNumber(comparisonStats.previousWeekAvgC);
      const currentMonthAvgC = finiteNumber(comparisonStats.currentMonthAvgC);
      const previousMonthAvgC = finiteNumber(comparisonStats.previousMonthAvgC);

      updateComparison(els.dayDelta, els.daySummary, todayAvgC, yesterdayAvgC, 'Hôm nay', 'hôm qua');
      updateComparison(els.weekDelta, els.weekSummary, currentWeekAvgC, previousWeekAvgC, 'Tuần này', 'tuần trước');
      updateComparison(els.monthDelta, els.monthSummary, currentMonthAvgC, previousMonthAvgC, 'Tháng này', 'tháng trước');

      const daysStored = Number(historyStats?.daysStored || comparisonStats.daysStored || 0);
      els.history.textContent = daysStored > 0
        ? `${daysStored} ngày${historyStats ? ' cloud' : ''}`
        : 'Đang tích lũy';
    }

    function render(reading) {
      const temperature = finiteNumber(reading.temperatureC);
      const humidity = finiteNumber(reading.humidity);
      if (Boolean(reading.deviceOnline) && Boolean(reading.sensorOnline) && temperature !== null && humidity !== null) {
        state.latestReadingForHistory = {
          recordedAtMs: reading.updatedAtIso ? Date.parse(reading.updatedAtIso) : Date.now(),
          temperatureC: temperature,
          humidity,
          chipTemperatureC: finiteNumber(reading.chipTemperatureC),
          sensorOnline: true
        };
      } else if (!reading.deviceOnline || !reading.sensorOnline) {
        state.latestReadingForHistory = null;
      }
      const displayStats = reading.stats || buildHistoryStats();

      const displayDate = reading.updatedAtIso ? new Date(reading.updatedAtIso) : new Date();
      els.updatedAt.textContent = new Intl.DateTimeFormat('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      }).format(displayDate);

      updateDeviceStatus(reading);
      updateStatus(reading);
      updateStats(reading.stats, reading);
      els.appVersion.textContent = reading.appVersion || '--';

      if (temperature === null || humidity === null) {
        els.temperature.textContent = '--.-';
        els.humidity.textContent = '--';
        updateComfort(null, null, displayStats, reading);
        updateMeters({ temperatureC: null, humidity: null });
        drawChart(els.tempChart, 'temperatureC', getComputedStyle(document.documentElement).getPropertyValue('--warm').trim());
        drawChart(els.humidityChart, 'humidity', getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
        return;
      }

      state.points.push({ temperatureC: temperature, humidity });
      state.points = state.points.slice(-90);

      els.temperature.textContent = temperature.toFixed(1);
      els.humidity.textContent = humidity.toFixed(0);

      updateComfort(temperature, humidity, displayStats, reading);
      updateMeters({ temperatureC: temperature, humidity });
      drawChart(els.tempChart, 'temperatureC', getComputedStyle(document.documentElement).getPropertyValue('--warm').trim());
      drawChart(els.humidityChart, 'humidity', getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
    }

    async function tick() {
      await maybeFetchCloudHistory();
      render(await fetchReading());
    }

    window.addEventListener('resize', () => {
      drawChart(els.tempChart, 'temperatureC', getComputedStyle(document.documentElement).getPropertyValue('--warm').trim());
      drawChart(els.humidityChart, 'humidity', getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
      drawHistoryChart();
    });

    els.rangeTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        state.historyRange = tab.dataset.range || 'day';
        els.rangeTabs.forEach(item => item.classList.toggle('active', item === tab));
        drawHistoryChart();
      });
    });

    tick();
    setInterval(tick, 1000);
  </script>
</body>
</html>

)HTML";

uint8_t crc8(const uint8_t *data, int length) {
  uint8_t crc = 0xFF;
  for (int i = 0; i < length; i++) {
    crc ^= data[i];
    for (int bit = 0; bit < 8; bit++) {
      crc = (crc & 0x80) ? (crc << 1) ^ 0x31 : (crc << 1);
    }
  }
  return crc;
}

bool readSht3x(float &temperatureC, float &humidity) {
  Wire.beginTransmission(SHT3X_ADDRESS);
  Wire.write(0x24);
  Wire.write(0x00);
  if (Wire.endTransmission() != 0) {
    return false;
  }

  delay(20);
  if (Wire.requestFrom((int)SHT3X_ADDRESS, 6) != 6) {
    return false;
  }

  uint8_t data[6];
  for (int i = 0; i < 6; i++) {
    data[i] = Wire.read();
  }

  if (crc8(data, 2) != data[2] || crc8(data + 3, 2) != data[5]) {
    return false;
  }

  uint16_t rawTemperature = ((uint16_t)data[0] << 8) | data[1];
  uint16_t rawHumidity = ((uint16_t)data[3] << 8) | data[4];

  temperatureC = -45.0f + 175.0f * ((float)rawTemperature / 65535.0f);
  humidity = 100.0f * ((float)rawHumidity / 65535.0f);
  humidity = constrain(humidity, 0.0f, 100.0f);
  return true;
}

Reading makeNoDataReading() {
  Reading reading;
  reading.temperatureC = NAN;
  reading.humidity = NAN;
  reading.sensorOnline = false;
  reading.updatedAtMs = millis();
  return reading;
}

bool getLocalDayContext(uint32_t &localDay, uint8_t &daysSinceMonday) {
  struct tm timeInfo;
  if (!getLocalTime(&timeInfo, 10)) {
    return false;
  }

  struct tm midnight = timeInfo;
  midnight.tm_hour = 0;
  midnight.tm_min = 0;
  midnight.tm_sec = 0;
  time_t midnightEpoch = mktime(&midnight);
  if (midnightEpoch < 1700000000) {
    return false;
  }

  localDay = (uint32_t)(midnightEpoch / 86400);
  daysSinceMonday = (uint8_t)((timeInfo.tm_wday + 6) % 7);
  return true;
}

uint32_t currentLocalDay() {
  uint32_t localDay;
  uint8_t daysSinceMonday;
  if (!getLocalDayContext(localDay, daysSinceMonday)) {
    return 0;
  }
  return localDay;
}

void resetDayStat(int slot, uint32_t day) {
  history[slot].day = day;
  history[slot].tempSum = 0;
  history[slot].humiditySum = 0;
  history[slot].samples = 0;
  history[slot].tempMin = NAN;
  history[slot].tempMax = NAN;
  history[slot].humidityMin = NAN;
  history[slot].humidityMax = NAN;
}

void loadHistory() {
  historyReady = preferences.begin("autohome", false);
  if (!historyReady) {
    Serial.println("History storage unavailable.");
    return;
  }

  size_t bytesRead = preferences.getBytes("daily", history, sizeof(history));
  if (bytesRead != sizeof(history)) {
    for (int i = 0; i < HISTORY_DAYS; i++) {
      resetDayStat(i, 0);
    }
  }
}

void saveHistory(bool force = false) {
  if (!historyReady || !historyDirty) {
    return;
  }

  if (!force && millis() - lastHistorySaveMs < HISTORY_SAVE_INTERVAL_MS) {
    return;
  }

  preferences.putBytes("daily", history, sizeof(history));
  historyDirty = false;
  lastHistorySaveMs = millis();
}

int historySlotForDay(uint32_t day) {
  int emptySlot = -1;
  int oldestSlot = 0;
  uint32_t oldestDay = UINT32_MAX;

  for (int i = 0; i < HISTORY_DAYS; i++) {
    if (history[i].day == day) {
      return i;
    }

    if (history[i].day == 0 && emptySlot < 0) {
      emptySlot = i;
    }

    if (history[i].day < oldestDay) {
      oldestDay = history[i].day;
      oldestSlot = i;
    }
  }

  int slot = emptySlot >= 0 ? emptySlot : oldestSlot;
  resetDayStat(slot, day);
  return slot;
}

void recordHistory(float temperatureC, float humidity) {
  if (!timeReady || isnan(temperatureC) || isinf(temperatureC) || isnan(humidity) || isinf(humidity)) {
    return;
  }

  uint32_t day = currentLocalDay();
  if (day == 0) {
    return;
  }

  int slot = historySlotForDay(day);
  history[slot].tempSum += temperatureC;
  history[slot].humiditySum += humidity;
  history[slot].samples += 1;

  if (isnan(history[slot].tempMin) || temperatureC < history[slot].tempMin) {
    history[slot].tempMin = temperatureC;
  }
  if (isnan(history[slot].tempMax) || temperatureC > history[slot].tempMax) {
    history[slot].tempMax = temperatureC;
  }
  if (isnan(history[slot].humidityMin) || humidity < history[slot].humidityMin) {
    history[slot].humidityMin = humidity;
  }
  if (isnan(history[slot].humidityMax) || humidity > history[slot].humidityMax) {
    history[slot].humidityMax = humidity;
  }

  historyDirty = true;
}

Average averageForRange(uint32_t startDay, uint32_t endDay) {
  Average average;
  double sum = 0;

  for (int i = 0; i < HISTORY_DAYS; i++) {
    if (history[i].day >= startDay && history[i].day <= endDay && history[i].samples > 0) {
      sum += history[i].tempSum;
      average.samples += history[i].samples;
      average.days += 1;
    }
  }

  if (average.samples > 0) {
    average.value = (float)(sum / average.samples);
  }

  return average;
}

uint8_t storedHistoryDays() {
  uint8_t days = 0;
  for (int i = 0; i < HISTORY_DAYS; i++) {
    if (history[i].day > 0 && history[i].samples > 0) {
      days += 1;
    }
  }
  return days;
}

int findHistorySlot(uint32_t day) {
  for (int i = 0; i < HISTORY_DAYS; i++) {
    if (history[i].day == day && history[i].samples > 0) {
      return i;
    }
  }
  return -1;
}

void recordTrend(float temperatureC, float humidity) {
  if (isnan(temperatureC) || isinf(temperatureC) || isnan(humidity) || isinf(humidity)) {
    return;
  }

  unsigned long now = millis();
  if (lastTrendSampleMs != 0 && now - lastTrendSampleMs < TREND_SAMPLE_INTERVAL_MS) {
    return;
  }

  trendPoints[trendIndex].timestampMs = now;
  trendPoints[trendIndex].temperatureC = temperatureC;
  trendPoints[trendIndex].humidity = humidity;
  trendIndex = (trendIndex + 1) % TREND_POINTS;
  lastTrendSampleMs = now;
}

TrendPoint trendReferencePoint() {
  unsigned long now = millis();
  TrendPoint reference;
  unsigned long bestDelta = ULONG_MAX;

  for (int i = 0; i < TREND_POINTS; i++) {
    if (trendPoints[i].timestampMs == 0) {
      continue;
    }

    unsigned long age = now - trendPoints[i].timestampMs;
    if (age < TREND_MIN_AGE_MS) {
      continue;
    }

    unsigned long delta = age > TREND_HORIZON_MS ? age - TREND_HORIZON_MS : TREND_HORIZON_MS - age;
    if (delta < bestDelta) {
      reference = trendPoints[i];
      bestDelta = delta;
    }
  }

  return reference;
}

void appendFloatOrNull(String &json, float value, uint8_t decimals) {
  if (isnan(value) || isinf(value)) {
    json += "null";
    return;
  }

  json += String(value, (unsigned int)decimals);
}

void appendIntOrNull(String &json, bool hasValue, long value) {
  if (!hasValue) {
    json += "null";
    return;
  }

  json += String(value);
}

void appendUint64OrNull(String &json, bool hasValue, uint64_t value) {
  if (!hasValue) {
    json += "null";
    return;
  }

  char buffer[24];
  snprintf(buffer, sizeof(buffer), "%llu", (unsigned long long)value);
  json += buffer;
}

uint64_t extendedUptimeMs() {
  uint32_t low = millis();
  if (low < uptimeLastLowMs) {
    uptimeHighMs += (1ULL << 32);
  }
  uptimeLastLowMs = low;
  return uptimeHighMs + low;
}

float readChipTemperatureC() {
  float value = temperatureRead();
  return (isnan(value) || isinf(value)) ? NAN : value;
}

void appendJsonString(String &json, const String &value) {
  json += "\"";
  for (size_t i = 0; i < value.length(); i++) {
    char c = value[i];
    if (c == '"' || c == '\\') {
      json += "\\";
      json += c;
    } else if (c == '\n') {
      json += "\\n";
    } else if (c == '\r') {
      json += "\\r";
    } else if (c == '\t') {
      json += "\\t";
    } else {
      json += c;
    }
  }
  json += "\"";
}

void appendJsonString(String &json, const char *value) {
  appendJsonString(json, String(value == nullptr ? "" : value));
}

void appendStatsJson(String &json) {
  uint32_t today;
  uint8_t daysSinceMonday;
  bool hasTime = timeReady && getLocalDayContext(today, daysSinceMonday);

  Average todayAverage;
  Average yesterdayAverage;
  Average currentWeekAverage;
  Average previousWeekAverage;

  if (hasTime) {
    uint32_t currentWeekStart = today - daysSinceMonday;
    uint32_t previousWeekStart = currentWeekStart - 7;
    uint32_t previousWeekEnd = previousWeekStart + daysSinceMonday;

    todayAverage = averageForRange(today, today);
    yesterdayAverage = averageForRange(today - 1, today - 1);
    currentWeekAverage = averageForRange(currentWeekStart, today);
    previousWeekAverage = averageForRange(previousWeekStart, previousWeekEnd);
  }

  int todaySlot = hasTime ? findHistorySlot(today) : -1;
  TrendPoint reference = trendReferencePoint();
  float temperatureTrend1h = (!lastReading.sensorOnline || isnan(reference.temperatureC)) ? NAN : lastReading.temperatureC - reference.temperatureC;
  float humidityTrend1h = (!lastReading.sensorOnline || isnan(reference.humidity)) ? NAN : lastReading.humidity - reference.humidity;

  json += ",\"stats\":{";
  json += "\"timeSynced\":";
  json += hasTime ? "true" : "false";
  json += ",\"daysStored\":";
  json += String((int)storedHistoryDays());
  json += ",\"todayAvgC\":";
  appendFloatOrNull(json, todayAverage.value, 1);
  json += ",\"yesterdayAvgC\":";
  appendFloatOrNull(json, yesterdayAverage.value, 1);
  json += ",\"currentWeekAvgC\":";
  appendFloatOrNull(json, currentWeekAverage.value, 1);
  json += ",\"previousWeekAvgC\":";
  appendFloatOrNull(json, previousWeekAverage.value, 1);
  json += ",\"todayMinC\":";
  appendFloatOrNull(json, todaySlot >= 0 ? history[todaySlot].tempMin : NAN, 1);
  json += ",\"todayMaxC\":";
  appendFloatOrNull(json, todaySlot >= 0 ? history[todaySlot].tempMax : NAN, 1);
  json += ",\"todayMinHumidity\":";
  appendFloatOrNull(json, todaySlot >= 0 ? history[todaySlot].humidityMin : NAN, 0);
  json += ",\"todayMaxHumidity\":";
  appendFloatOrNull(json, todaySlot >= 0 ? history[todaySlot].humidityMax : NAN, 0);
  json += ",\"temperatureTrend1hC\":";
  appendFloatOrNull(json, temperatureTrend1h, 1);
  json += ",\"humidityTrend1h\":";
  appendFloatOrNull(json, humidityTrend1h, 0);
  json += ",\"todaySamples\":";
  json += String(todayAverage.samples);
  json += ",\"yesterdaySamples\":";
  json += String(yesterdayAverage.samples);
  json += ",\"currentWeekSamples\":";
  json += String(currentWeekAverage.samples);
  json += ",\"previousWeekSamples\":";
  json += String(previousWeekAverage.samples);
  json += "}";
}

void refreshTimeStatus() {
  if (!stationConnected()) {
    timeReady = false;
    return;
  }

  if (timeReady && millis() - lastTimeCheckMs < TIME_CHECK_INTERVAL_MS) {
    return;
  }

  lastTimeCheckMs = millis();
  uint32_t localDay = currentLocalDay();
  timeReady = localDay > 0;
}

void sampleSensor() {
  float temperatureC;
  float humidity;

  if (readSht3x(temperatureC, humidity)) {
    lastReading.temperatureC = temperatureC;
    lastReading.humidity = humidity;
    lastReading.sensorOnline = true;
    lastReading.updatedAtMs = millis();
    lastSensorOkMs = extendedUptimeMs();
    recordHistory(temperatureC, humidity);
    recordTrend(temperatureC, humidity);
    return;
  }

  lastReading = makeNoDataReading();
}

void maybeSampleSensor(bool force = false) {
  if (!force && millis() - lastSampleMs < SAMPLE_INTERVAL_MS) {
    return;
  }

  lastSampleMs = millis();
  sampleSensor();
}

String currentIpAddress() {
  if (stationConnected()) {
    return WiFi.localIP().toString();
  }
  if (accessPointActive()) {
    return WiFi.softAPIP().toString();
  }
  return "0.0.0.0";
}

bool stationConnected() {
  return WiFi.status() == WL_CONNECTED;
}

bool accessPointActive() {
  wifi_mode_t mode = WiFi.getMode();
  return mode == WIFI_AP || mode == WIFI_AP_STA;
}

const char *currentWifiModeName() {
  if (stationConnected()) {
    return accessPointActive() ? "AP+STA" : "STA";
  }
  return accessPointActive() ? "AP" : "STA";
}

bool supabaseConfigured() {
  return strlen(SUPABASE_URL) > 0 && strlen(SUPABASE_PUBLISHABLE_KEY) > 0;
}

String buildCloudPayload() {
  bool wifiConnected = stationConnected();
  uint64_t uptimeMs = extendedUptimeMs();

  String json;
  json.reserve(560);
  json += "{\"room_id\":";
  appendJsonString(json, SUPABASE_ROOM_ID);
  json += ",\"app_version\":";
  appendJsonString(json, APP_VERSION);
  json += ",\"device_online\":true";
  json += ",\"wifi_connected\":";
  json += wifiConnected ? "true" : "false";
  json += ",\"wifi_mode\":";
  appendJsonString(json, currentWifiModeName());
  json += ",\"wifi_rssi\":";
  appendIntOrNull(json, wifiConnected, wifiConnected ? WiFi.RSSI() : 0);
  json += ",\"free_heap\":";
  json += String(ESP.getFreeHeap());
  json += ",\"chip_temperature_c\":";
  appendFloatOrNull(json, readChipTemperatureC(), 1);
  json += ",\"last_sensor_ok_ms\":";
  appendUint64OrNull(json, lastSensorOkMs > 0, lastSensorOkMs);
  json += ",\"temperature_c\":";
  appendFloatOrNull(json, lastReading.temperatureC, 1);
  json += ",\"humidity\":";
  appendFloatOrNull(json, lastReading.humidity, 0);
  json += ",\"sensor_online\":";
  json += lastReading.sensorOnline ? "true" : "false";
  json += ",\"source\":";
  appendJsonString(json, lastReading.sensorOnline ? "SHT30" : "No data");
  json += ",\"uptime_ms\":";
  appendUint64OrNull(json, true, uptimeMs);
  json += ",\"local_ip\":";
  appendJsonString(json, currentIpAddress());
  json += "}";
  return json;
}

String buildHistoryPayload() {
  bool wifiConnected = stationConnected();

  String json;
  json.reserve(420);
  json += "{\"room_id\":";
  appendJsonString(json, SUPABASE_ROOM_ID);
  json += ",\"app_version\":";
  appendJsonString(json, APP_VERSION);
  json += ",\"sensor_online\":";
  json += lastReading.sensorOnline ? "true" : "false";
  json += ",\"temperature_c\":";
  appendFloatOrNull(json, lastReading.temperatureC, 1);
  json += ",\"humidity\":";
  appendFloatOrNull(json, lastReading.humidity, 0);
  json += ",\"chip_temperature_c\":";
  appendFloatOrNull(json, readChipTemperatureC(), 1);
  json += ",\"wifi_rssi\":";
  appendIntOrNull(json, wifiConnected, wifiConnected ? WiFi.RSSI() : 0);
  json += ",\"source\":";
  appendJsonString(json, lastReading.sensorOnline ? "SHT30" : "No data");
  json += ",\"uptime_ms\":";
  appendUint64OrNull(json, true, extendedUptimeMs());
  json += "}";
  return json;
}

void uploadLatestToSupabase(bool force = false) {
  if (!supabaseConfigured() || !stationConnected()) {
    return;
  }

  unsigned long now = millis();
  if (!force && lastCloudUploadMs != 0 && now - lastCloudUploadMs < CLOUD_UPLOAD_INTERVAL_MS) {
    return;
  }
  lastCloudUploadMs = now;

  WiFiClientSecure client;
  client.setCACert(SUPABASE_ROOT_CA);

  HTTPClient https;
  String endpoint = String(SUPABASE_URL) + "/rest/v1/room_latest?on_conflict=room_id";
  if (!https.begin(client, endpoint)) {
    lastCloudUploadOk = false;
    lastCloudStatusCode = -1;
    Serial.println("Supabase upload failed: HTTPS begin failed.");
    return;
  }

  https.addHeader("apikey", SUPABASE_PUBLISHABLE_KEY);
  https.addHeader("Content-Type", "application/json");
  https.addHeader("Prefer", "resolution=merge-duplicates,return=minimal");
  https.addHeader("x-device-token", SUPABASE_DEVICE_TOKEN);

  int code = https.POST(buildCloudPayload());
  lastCloudStatusCode = code;
  lastCloudUploadOk = code >= 200 && code < 300;

  if (!lastCloudUploadOk) {
    String body = https.getString();
    Serial.print("Supabase upload failed: ");
    Serial.print(code);
    Serial.print(" ");
    Serial.println(body);
  }

  https.end();
}

void uploadHistoryToSupabase(bool force = false) {
  if (!supabaseConfigured() || !stationConnected()) {
    return;
  }

  unsigned long now = millis();
  if (!force && lastCloudHistoryMs != 0 && now - lastCloudHistoryMs < CLOUD_HISTORY_INTERVAL_MS) {
    return;
  }
  lastCloudHistoryMs = now;

  WiFiClientSecure client;
  client.setCACert(SUPABASE_ROOT_CA);

  HTTPClient https;
  String endpoint = String(SUPABASE_URL) + "/rest/v1/room_readings";
  if (!https.begin(client, endpoint)) {
    lastCloudHistoryOk = false;
    lastCloudHistoryStatusCode = -1;
    Serial.println("Supabase history failed: HTTPS begin failed.");
    return;
  }

  https.addHeader("apikey", SUPABASE_PUBLISHABLE_KEY);
  https.addHeader("Content-Type", "application/json");
  https.addHeader("Prefer", "return=minimal");
  https.addHeader("x-device-token", SUPABASE_DEVICE_TOKEN);

  int code = https.POST(buildHistoryPayload());
  lastCloudHistoryStatusCode = code;
  lastCloudHistoryOk = code >= 200 && code < 300;

  if (!lastCloudHistoryOk) {
    String body = https.getString();
    Serial.print("Supabase history failed: ");
    Serial.print(code);
    Serial.print(" ");
    Serial.println(body);
  }

  https.end();
}

void sendNoCache() {
  server.sendHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  server.sendHeader("Pragma", "no-cache");
}

void handleIndex() {
  sendNoCache();
  server.send_P(200, "text/html", INDEX_HTML);
}

void handleReadings() {
  refreshTimeStatus();
  maybeSampleSensor();

  bool wifiConnected = stationConnected();
  uint64_t uptimeMs = extendedUptimeMs();

  String json;
  json.reserve(1120);
  json += "{";
  json += "\"appVersion\":\"";
  json += APP_VERSION;
  json += "\",\"deviceOnline\":true";
  json += ",\"wifiConnected\":";
  json += wifiConnected ? "true" : "false";
  json += ",\"wifiMode\":\"";
  json += currentWifiModeName();
  json += "\",\"wifiRssi\":";
  appendIntOrNull(json, wifiConnected, wifiConnected ? WiFi.RSSI() : 0);
  json += ",\"freeHeap\":";
  json += String(ESP.getFreeHeap());
  json += ",\"chipTemperatureC\":";
  appendFloatOrNull(json, readChipTemperatureC(), 1);
  json += ",\"lastSensorOkMs\":";
  appendUint64OrNull(json, lastSensorOkMs > 0, lastSensorOkMs);
  json += ",";
  json += "\"temperatureC\":";
  appendFloatOrNull(json, lastReading.temperatureC, 1);
  json += ",\"humidity\":";
  appendFloatOrNull(json, lastReading.humidity, 0);
  json += ",\"sensorOnline\":";
  json += lastReading.sensorOnline ? "true" : "false";
  json += ",\"source\":\"";
  json += lastReading.sensorOnline ? "SHT30" : "No data";
  json += "\",\"uptimeMs\":";
  appendUint64OrNull(json, true, uptimeMs);
  json += ",\"ip\":\"";
  json += currentIpAddress();
  json += "\",\"cloudEnabled\":";
  json += supabaseConfigured() ? "true" : "false";
  json += ",\"cloudUploadOk\":";
  json += lastCloudUploadOk ? "true" : "false";
  json += ",\"cloudStatusCode\":";
  json += String(lastCloudStatusCode);
  json += ",\"cloudHistoryOk\":";
  json += lastCloudHistoryOk ? "true" : "false";
  json += ",\"cloudHistoryStatusCode\":";
  json += String(lastCloudHistoryStatusCode);
  appendStatsJson(json);
  json += "}";

  sendNoCache();
  server.send(200, "application/json", json);
}

void handleHealth() {
  sendNoCache();
  String json;
  json.reserve(80);
  json += "{\"ok\":true,\"appVersion\":\"";
  json += APP_VERSION;
  json += "\"}";
  server.send(200, "application/json", json);
}

void handleNotFound() {
  sendNoCache();
  server.send(404, "application/json", "{\"error\":\"not_found\"}");
}

void startAccessPoint() {
  WiFi.mode(strlen(WIFI_SSID) > 0 ? WIFI_AP_STA : WIFI_AP);
  if (accessPointStarted) {
    return;
  }

  if (!WiFi.softAP(AP_SSID, AP_PASSWORD)) {
    Serial.println("WiFi fallback AP failed to start.");
    return;
  }
  accessPointStarted = true;

  Serial.println();
  Serial.println("WiFi fallback AP started");
  Serial.print("SSID: ");
  Serial.println(AP_SSID);
  Serial.print("Password: ");
  Serial.println(AP_PASSWORD);
  Serial.print("Open: http://");
  Serial.println(WiFi.softAPIP());
}

void connectNetwork() {
  if (strlen(WIFI_SSID) == 0) {
    startAccessPoint();
    return;
  }

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.print("Connecting to WiFi");
  unsigned long startedAt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startedAt < WIFI_TIMEOUT_MS) {
    delay(250);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    stationWasConnected = true;
    Serial.print("WiFi connected. Open: http://");
    Serial.println(WiFi.localIP());
    return;
  }

  Serial.println("WiFi connection failed.");
  startAccessPoint();
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  lastWifiRetryMs = millis();
}

void setupTimeSync() {
  if (!stationConnected()) {
    Serial.println("NTP skipped in fallback AP mode.");
    return;
  }

  configTzTime(TIME_ZONE, "pool.ntp.org", "time.nist.gov");
  timeSyncConfigured = true;

  Serial.print("Syncing time");
  struct tm timeInfo;
  for (int i = 0; i < 20; i++) {
    if (getLocalTime(&timeInfo, 500)) {
      timeReady = true;
      Serial.println();
      Serial.print("Time synced: ");
      Serial.println(&timeInfo, "%Y-%m-%d %H:%M:%S");
      return;
    }
    Serial.print(".");
  }

  Serial.println();
  Serial.println("Time sync pending. History comparisons will start after NTP is ready.");
}

void setupServer() {
  server.on("/", HTTP_GET, handleIndex);
  server.on("/api/readings", HTTP_GET, handleReadings);
  server.on("/health", HTTP_GET, handleHealth);
  server.onNotFound(handleNotFound);
  server.begin();
}

void setupMdns() {
  if (!stationConnected() || mdnsStarted) {
    return;
  }

  if (MDNS.begin(MDNS_NAME)) {
    mdnsStarted = true;
    MDNS.addService("http", "tcp", 80);
    Serial.print("mDNS: http://");
    Serial.print(MDNS_NAME);
    Serial.println(".local");
  }
}

void maintainNetwork() {
  bool connected = stationConnected();

  if (connected) {
    if (!stationWasConnected) {
      Serial.print("WiFi reconnected. Open: http://");
      Serial.println(WiFi.localIP());

      if (accessPointStarted) {
        WiFi.softAPdisconnect(true);
        accessPointStarted = false;
        WiFi.mode(WIFI_STA);
      }

      if (!timeSyncConfigured) {
        configTzTime(TIME_ZONE, "pool.ntp.org", "time.nist.gov");
        timeSyncConfigured = true;
      }
      setupMdns();
      lastCloudUploadMs = 0;
      lastCloudHistoryMs = 0;
      uploadLatestToSupabase(true);
    }
    stationWasConnected = true;
    return;
  }

  if (stationWasConnected) {
    Serial.println("WiFi disconnected. Enabling fallback AP and retry loop.");
    if (mdnsStarted) {
      MDNS.end();
      mdnsStarted = false;
    }
  }
  stationWasConnected = false;
  timeReady = false;
  timeSyncConfigured = false;

  if (strlen(WIFI_SSID) == 0) {
    startAccessPoint();
    return;
  }

  startAccessPoint();
  unsigned long now = millis();
  if (lastWifiRetryMs != 0 && now - lastWifiRetryMs < WIFI_RETRY_INTERVAL_MS) {
    return;
  }

  lastWifiRetryMs = now;
  Serial.println("Retrying home WiFi in AP+STA mode...");
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

void setup() {
  Serial.begin(115200);
  delay(250);
  Serial.print("Firmware version: ");
  Serial.println(APP_VERSION);

  Wire.begin(SDA_PIN, SCL_PIN);
  loadHistory();
  connectNetwork();
  setupTimeSync();
  setupMdns();
  setupServer();
  refreshTimeStatus();
  maybeSampleSensor(true);
  uploadLatestToSupabase(true);
  uploadHistoryToSupabase(true);
}

void loop() {
  extendedUptimeMs();
  server.handleClient();
  maintainNetwork();
  refreshTimeStatus();

  maybeSampleSensor();
  uploadLatestToSupabase();
  uploadHistoryToSupabase();
  saveHistory();
}
