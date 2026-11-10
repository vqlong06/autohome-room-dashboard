/**
 * LongOS 3D Digital Twin - Data Adapter
 * Converts LongOS dashboard telemetry into versioned RoomSnapshot v1.
 */

function finiteNumber(val) {
  return typeof val === 'number' && Number.isFinite(val) ? val : null;
}

export function toRoomSnapshot(reading, options = {}) {
  const r = reading || {};
  const isOnline = Boolean(r.deviceOnline && (r.isOnline ?? true));
  const isSensorOnline = Boolean(r.sensorOnline ?? isOnline);
  const temp = finiteNumber(r.temperatureC ?? r.temperature);
  const hum = finiteNumber(r.humidityPct ?? r.humidity);
  const chipTemp = finiteNumber(r.chipTemperatureC);

  const timestamp = r.updatedAtIso || (r.timestamp ? new Date(r.timestamp).toISOString() : new Date().toISOString());
  const ageMs = typeof r.cloudAgeMs === 'number' && Number.isFinite(r.cloudAgeMs)
    ? Math.max(0, r.cloudAgeMs)
    : (r.updatedAt ? Math.max(0, Date.now() - new Date(r.updatedAt).getTime()) : 0);

  const isStale = !isOnline || ageMs > 120000; // 2 minutes stale threshold

  return {
    schemaVersion: 1,
    roomId: options.roomId || 'main-room',
    timestamp,
    source: r.cloudMode ? 'supabase' : (r.source || 'supabase'),
    freshness: {
      ageMs,
      stale: isStale
    },
    sensors: {
      main_sht30: {
        id: 'main_sht30',
        label: 'SHT30',
        online: isOnline && isSensorOnline,
        updatedAt: timestamp,
        temperatureC: isOnline ? temp : null,
        humidityPct: isOnline ? hum : null
      }
    },
    room: {
      deviceOnline: isOnline,
      sensorOnline: isSensorOnline,
      wifiConnected: Boolean(r.wifiConnected ?? isOnline),
      chipTemperatureC: chipTemp
    },
    outdoor: r.outdoor || null,
    devices: r.devices || {}
  };
}

export function isSensorEligibleForHeat(sensor, snapshot) {
  if (!sensor || !snapshot) return false;
  if (!sensor.online) return false;
  if (snapshot.freshness?.stale) return false;
  return typeof sensor.temperatureC === 'number' && Number.isFinite(sensor.temperatureC);
}
