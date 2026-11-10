/**
 * LongOS 3D Digital Twin - Heatmap Module
 * Computes spatial Inverse Distance Weighting (IDW) interpolation.
 * Strict adherence to AD-06: Heatmap is only enabled when sensor count >= 3.
 */

export class Room3DHeatmap {
  constructor(config = {}) {
    this.config = config.heatmap || {};
    this.minSensors = this.config.enabledWhenSensorCountAtLeast ?? 3;
    this.planeY = this.config.planeY ?? 1.1;
    this.idwPower = this.config.idwPower ?? 2;
    this.extents = this.config.extents || { minX: -2.0, maxX: 2.0, minZ: -2.0, maxZ: 2.0 };
    this.canvas = document.createElement('canvas');
    this.canvas.width = 64;
    this.canvas.height = 64;
    this.ctx = this.canvas.getContext('2d');
  }

  evaluateSensors(sensorsMap = {}, snapshot = {}) {
    const eligible = [];
    for (const sensorId in sensorsMap) {
      const s = sensorsMap[sensorId];
      if (!s || !s.online) continue;
      if (snapshot.freshness?.stale) continue;
      if (typeof s.temperatureC === 'number' && Number.isFinite(s.temperatureC)) {
        eligible.push(s);
      }
    }
    return eligible;
  }

  isEligible(sensorsMap, snapshot) {
    const eligibleSensors = this.evaluateSensors(sensorsMap, snapshot);
    return eligibleSensors.length >= this.minSensors;
  }

  getEligibilityStatus(sensorsMap, snapshot) {
    const eligibleSensors = this.evaluateSensors(sensorsMap, snapshot);
    if (eligibleSensors.length >= this.minSensors) {
      return {
        enabled: true,
        eligibleCount: eligibleSensors.length,
        message: `Đang nội suy IDW từ ${eligibleSensors.length} điểm đo.`
      };
    }
    return {
      enabled: false,
      eligibleCount: eligibleSensors.length,
      message: eligibleSensors.length === 1
        ? 'Phòng hiện có 1 cảm biến SHT30 (hiển thị điểm đo trực tiếp, không vẽ bản đồ nhiệt giả).'
        : `Hiện có ${eligibleSensors.length} cảm biến sẵn sàng (yêu cầu tối thiểu ${this.minSensors} để kích hoạt bản đồ nhiệt).`
    };
  }

  // IDW interpolation calculation
  computeGrid(sensorsWithCoords) {
    const width = this.canvas.width;
    const height = this.canvas.height;
    const imgData = this.ctx.createImageData(width, height);
    const data = imgData.data;

    const { minX, maxX, minZ, maxZ } = this.extents;
    const power = this.idwPower;
    const epsilon = 0.05;

    for (let py = 0; py < height; py++) {
      const z = minZ + (py / (height - 1)) * (maxZ - minZ);
      for (let px = 0; px < width; px++) {
        const x = minX + (px / (width - 1)) * (maxX - minX);

        let sumWeights = 0;
        let sumTemp = 0;

        for (const s of sensorsWithCoords) {
          const dx = x - s.x;
          const dz = z - s.z;
          const dist = Math.max(Math.sqrt(dx * dx + dz * dz), epsilon);
          const weight = 1 / Math.pow(dist, power);

          sumWeights += weight;
          sumTemp += weight * s.temperatureC;
        }

        const t = sumWeights > 0 ? sumTemp / sumWeights : 25;
        // Map temperature (range 20°C - 34°C) to hue (240 = blue, 0 = red)
        const normalized = Math.max(0, Math.min(1, (t - 22) / 10)); // 22°C (cool) to 32°C (warm)
        const hue = (1 - normalized) * 200; // Blue (200) to Red/Orange (0)
        const [r, g, b] = this.hslToRgb(hue / 360, 0.85, 0.5);

        const index = (py * width + px) * 4;
        data[index] = r;
        data[index + 1] = g;
        data[index + 2] = b;
        data[index + 3] = 160; // Semi-transparent
      }
    }

    this.ctx.putImageData(imgData, 0, 0);
    return this.canvas;
  }

  hslToRgb(h, s, l) {
    let r, g, b;
    if (s === 0) {
      r = g = b = l;
    } else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      const hue2rgb = (t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      };
      r = hue2rgb(h + 1 / 3);
      g = hue2rgb(h);
      b = hue2rgb(h - 1 / 3);
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }
}
