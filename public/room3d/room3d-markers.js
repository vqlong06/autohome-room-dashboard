/**
 * LongOS 3D Digital Twin - HTML Overlay Markers
 * Projects 3D world coordinates onto 2D screen space for crisp, accessible UI.
 */

export class Room3DMarkers {
  constructor(overlayContainer, options = {}) {
    this.container = overlayContainer;
    this.markers = new Map();
    this.onSelect = options.onSelect || (() => {});
    this.activePopover = null;
  }

  initMarkers(config, camera) {
    this.container.innerHTML = '';
    this.markers.clear();

    const sensors = config.sensors || [];
    for (const sensor of sensors) {
      const el = document.createElement('div');
      el.className = 'room3d-marker sensor-marker';
      el.dataset.sensorId = sensor.id;
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      el.setAttribute('aria-label', `${sensor.label}: đang tải`);

      el.innerHTML = `
        <div class="marker-pulse"></div>
        <div class="marker-badge">
          <span class="marker-icon">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
            </svg>
          </span>
          <span class="marker-temp">--°C</span>
          <span class="marker-hum">--%</span>
        </div>
        <div class="marker-label">${sensor.label}</div>
      `;

      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showPopover(sensor, el);
        this.onSelect(sensor);
      });

      this.container.appendChild(el);
      this.markers.set(sensor.id, {
        type: 'sensor',
        data: sensor,
        element: el,
        position: sensor.position
      });
    }

    const hotspots = config.hotspots || [];
    for (const hotspot of hotspots) {
      const el = document.createElement('div');
      el.className = 'room3d-marker hotspot-marker';
      el.dataset.hotspotId = hotspot.id;
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      el.setAttribute('aria-label', hotspot.label);

      el.innerHTML = `
        <div class="hotspot-dot"></div>
        <div class="hotspot-label">${hotspot.label}</div>
      `;

      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showHotspotPopover(hotspot, el);
        this.onSelect(hotspot);
      });

      this.container.appendChild(el);
      this.markers.set(`hotspot_${hotspot.id}`, {
        type: 'hotspot',
        data: hotspot,
        element: el,
        position: hotspot.position
      });
    }
  }

  updateSnapshot(snapshot) {
    if (!snapshot || !snapshot.sensors) return;

    for (const [id, item] of this.markers.entries()) {
      if (item.type !== 'sensor') continue;
      const sensorData = snapshot.sensors[item.data.id];
      const el = item.element;
      const isStale = snapshot.freshness?.stale;

      if (!sensorData || !sensorData.online || isStale) {
        el.classList.add('marker-stale');
        el.classList.toggle('marker-offline', !sensorData?.online);
        const tempEl = el.querySelector('.marker-temp');
        const humEl = el.querySelector('.marker-hum');
        if (tempEl) tempEl.textContent = sensorData?.temperatureC != null ? `${sensorData.temperatureC.toFixed(1)}°` : '--°';
        if (humEl) humEl.textContent = isStale ? 'Cũ' : 'Off';
      } else {
        el.classList.remove('marker-stale', 'marker-offline');
        const tempEl = el.querySelector('.marker-temp');
        const humEl = el.querySelector('.marker-hum');
        if (tempEl) tempEl.textContent = `${sensorData.temperatureC.toFixed(1)}°C`;
        if (humEl) humEl.textContent = `${Math.round(sensorData.humidityPct)}%`;
      }
    }
  }

  updatePositions(camera, width, height, THREE) {
    if (!THREE) return;
    const tempV = new THREE.Vector3();

    for (const item of this.markers.values()) {
      tempV.set(item.position[0], item.position[1], item.position[2]);
      tempV.project(camera);

      // Hide if behind camera
      if (tempV.z > 1) {
        item.element.style.display = 'none';
        continue;
      }

      item.element.style.display = 'flex';
      const x = (tempV.x * 0.5 + 0.5) * width;
      const y = (-tempV.y * 0.5 + 0.5) * height;

      item.element.style.transform = `translate(-50%, -50%) translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    }

    if (this.activePopover) {
      this.repositionPopover(width, height);
    }
  }

  showPopover(sensor, anchorEl) {
    this.closePopover();
    const pop = document.createElement('div');
    pop.className = 'room3d-popover';
    pop.innerHTML = `
      <div class="popover-header">
        <strong>${sensor.label}</strong>
        <button type="button" class="popover-close" aria-label="Đóng">&times;</button>
      </div>
      <div class="popover-body">
        <div class="popover-row"><span>Vị trí:</span> <span>[${sensor.position.map(n => n.toFixed(2)).join(', ')}]</span></div>
        <div class="popover-row"><span>Cảm biến:</span> <span>SHT30 I2C (ESP32)</span></div>
        <div class="popover-row"><span>Trạng thái:</span> <span class="badge-online">Đang đồng bộ</span></div>
      </div>
    `;

    pop.querySelector('.popover-close').addEventListener('click', () => this.closePopover());
    this.container.appendChild(pop);
    this.activePopover = { el: pop, anchorEl };
  }

  showHotspotPopover(hotspot, anchorEl) {
    this.closePopover();
    const pop = document.createElement('div');
    pop.className = 'room3d-popover';
    pop.innerHTML = `
      <div class="popover-header">
        <strong>${hotspot.label}</strong>
        <button type="button" class="popover-close" aria-label="Đóng">&times;</button>
      </div>
      <div class="popover-body">
        <p class="popover-desc">${hotspot.description || 'Vị trí neo trong không gian phòng'}</p>
        <div class="popover-row"><span>Tọa độ:</span> <span>[${hotspot.position.map(n => n.toFixed(2)).join(', ')}]</span></div>
      </div>
    `;

    pop.querySelector('.popover-close').addEventListener('click', () => this.closePopover());
    this.container.appendChild(pop);
    this.activePopover = { el: pop, anchorEl };
  }

  closePopover() {
    if (this.activePopover) {
      this.activePopover.el.remove();
      this.activePopover = null;
    }
  }

  repositionPopover(width, height) {
    if (!this.activePopover) return;
    const anchor = this.activePopover.anchorEl;
    const rect = anchor.getBoundingClientRect();
    const parentRect = this.container.getBoundingClientRect();
    const x = rect.left - parentRect.left + rect.width / 2;
    const y = rect.top - parentRect.top;

    const pop = this.activePopover.el;
    pop.style.left = `${Math.max(10, Math.min(width - 240, x - 110))}px`;
    pop.style.top = `${Math.max(10, y - 110)}px`;
  }

  dispose() {
    this.closePopover();
    this.container.innerHTML = '';
    this.markers.clear();
  }
}
