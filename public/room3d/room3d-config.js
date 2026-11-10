/**
 * LongOS 3D Digital Twin - Room Configuration & Validator
 * Conforms to RoomConfig v1 schema defined in Implementation Plan.
 */

export const DEFAULT_ROOM_CONFIG = Object.freeze({
  schemaVersion: 1,
  roomId: 'main-room',
  model: {
    version: 'room-v1',
    units: 'meters',
    webUpAxis: 'Y',
    defaultModelUrl: null // Procedural room active until user's GLB is loaded
  },
  camera: {
    defaultPreset: 'overview',
    presets: {
      overview: {
        position: [3.4, 2.6, 3.8],
        target: [0, 0.8, 0]
      },
      top: {
        position: [0.01, 5.2, 0],
        target: [0, 0, 0]
      },
      desk: {
        position: [2.0, 1.5, 0.4],
        target: [1.1, 0.75, -0.6]
      }
    }
  },
  sensors: [
    {
      id: 'main_sht30',
      label: 'SHT30 Cảm biến phòng',
      position: [1.1, 1.15, -0.6],
      capabilities: ['temperature', 'humidity']
    }
  ],
  hotspots: [
    {
      id: 'desk',
      label: 'Bàn làm việc',
      position: [1.1, 0.75, -0.6],
      description: 'Khu vực làm việc và vị trí cảm biến SHT30 ESP32'
    },
    {
      id: 'bed',
      label: 'Giường ngủ',
      position: [-1.2, 0.55, 0.8],
      description: 'Khu vực nghỉ ngơi, theo dõi giấc ngủ qua HealthKit'
    },
    {
      id: 'ac',
      label: 'Điều hòa nhiệt độ',
      position: [0, 2.1, -1.85],
      description: 'Điều hòa và suy luận trạng thái làm mát'
    }
  ],
  heatmap: {
    enabledWhenSensorCountAtLeast: 3,
    planeY: 1.1,
    idwPower: 2,
    extents: {
      minX: -2.0,
      maxX: 2.0,
      minZ: -2.0,
      maxZ: 2.0
    }
  }
});

export function isFiniteNumber(val) {
  return typeof val === 'number' && Number.isFinite(val);
}

export function isValidVector3(arr) {
  return Array.isArray(arr) && arr.length === 3 && arr.every(isFiniteNumber);
}

export function validateRoomConfig(config) {
  if (!config || typeof config !== 'object') {
    throw new Error('RoomConfig must be an object');
  }
  if (config.schemaVersion !== 1) {
    throw new Error(`Unsupported RoomConfig schemaVersion: ${config.schemaVersion}. Expected 1.`);
  }
  if (typeof config.roomId !== 'string' || !config.roomId.trim()) {
    throw new Error('RoomConfig requires a non-empty roomId string');
  }

  // Sensors validation
  const sensorIds = new Set();
  const validSensors = [];
  if (Array.isArray(config.sensors)) {
    for (const sensor of config.sensors) {
      if (!sensor || typeof sensor !== 'object' || typeof sensor.id !== 'string') continue;
      if (sensorIds.has(sensor.id)) {
        console.warn(`[RoomConfig] Duplicate sensor ID: ${sensor.id}`);
        continue;
      }
      sensorIds.add(sensor.id);
      validSensors.push({
        id: sensor.id,
        label: sensor.label || sensor.id,
        position: isValidVector3(sensor.position) ? [...sensor.position] : [0, 1, 0],
        capabilities: Array.isArray(sensor.capabilities) ? [...sensor.capabilities] : ['temperature']
      });
    }
  }

  // Hotspots validation
  const validHotspots = [];
  if (Array.isArray(config.hotspots)) {
    for (const hotspot of config.hotspots) {
      if (!hotspot || typeof hotspot !== 'object' || typeof hotspot.id !== 'string') continue;
      validHotspots.push({
        id: hotspot.id,
        label: hotspot.label || hotspot.id,
        position: isValidVector3(hotspot.position) ? [...hotspot.position] : [0, 0.5, 0],
        description: hotspot.description || ''
      });
    }
  }

  return {
    schemaVersion: 1,
    roomId: config.roomId,
    model: {
      version: config.model?.version || 'room-v1',
      units: config.model?.units || 'meters',
      webUpAxis: config.model?.webUpAxis || 'Y',
      defaultModelUrl: config.model?.defaultModelUrl || null
    },
    camera: {
      defaultPreset: config.camera?.defaultPreset || 'overview',
      presets: config.camera?.presets || DEFAULT_ROOM_CONFIG.camera.presets
    },
    sensors: validSensors,
    hotspots: validHotspots,
    heatmap: {
      enabledWhenSensorCountAtLeast: config.heatmap?.enabledWhenSensorCountAtLeast ?? 3,
      planeY: isFiniteNumber(config.heatmap?.planeY) ? config.heatmap.planeY : 1.1,
      idwPower: isFiniteNumber(config.heatmap?.idwPower) ? config.heatmap.idwPower : 2,
      extents: config.heatmap?.extents || DEFAULT_ROOM_CONFIG.heatmap.extents
    }
  };
}
