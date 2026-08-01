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
#include "longos_config.h"
#include "supabase_ca.h"
#include "web_assets.h"

const char *WIFI_SSID = LONGOS_WIFI_SSID;
const char *WIFI_PASSWORD = LONGOS_WIFI_PASSWORD;

const char *MDNS_NAME = "longos-sensor";
const char *AP_SSID = "LongOS-Sensor";
const char *AP_PASSWORD = LONGOS_AP_PASSWORD;
const char *TIME_ZONE = "ICT-7";
const char *APP_VERSION = "longos-sensor-2026-08-01.3";
const char *SUPABASE_URL = LONGOS_SUPABASE_URL;
const char *SUPABASE_PUBLISHABLE_KEY = LONGOS_SUPABASE_PUBLISHABLE_KEY;
const char *SUPABASE_ROOM_ID = LONGOS_SUPABASE_ROOM_ID;
const char *SUPABASE_DEVICE_TOKEN = LONGOS_SUPABASE_DEVICE_TOKEN;
const char *LEGACY_HISTORY_NAMESPACE = "autohome";

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
  // Keep the legacy namespace so existing devices retain their 21-day history.
  historyReady = preferences.begin(LEGACY_HISTORY_NAMESPACE, false);
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

void sendImmutableCache() {
  server.sendHeader("Cache-Control", "public, max-age=31536000, immutable");
}

void sendGzipHeaders() {
  server.sendHeader("Content-Encoding", "gzip");
  server.sendHeader("Vary", "Accept-Encoding");
}

void handleIndex() {
  sendNoCache();
  sendGzipHeaders();
  server.send_P(
    200,
    "text/html; charset=utf-8",
    reinterpret_cast<PGM_P>(INDEX_HTML_GZ),
    INDEX_HTML_GZ_LENGTH
  );
}

void handleFavicon() {
  sendImmutableCache();
  sendGzipHeaders();
  server.send_P(
    200,
    "image/svg+xml",
    reinterpret_cast<PGM_P>(FAVICON_SVG_GZ),
    FAVICON_SVG_GZ_LENGTH
  );
}

void handleAppleTouchIcon() {
  sendImmutableCache();
  server.send_P(
    200,
    "image/png",
    reinterpret_cast<PGM_P>(APPLE_TOUCH_ICON_PNG),
    APPLE_TOUCH_ICON_PNG_LENGTH
  );
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
  server.on("/favicon.svg", HTTP_GET, handleFavicon);
  server.on("/apple-touch-icon.png", HTTP_GET, handleAppleTouchIcon);
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
