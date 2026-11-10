/**
 * LongOS 3D Digital Twin - Debug Placement Mode
 * Activates with ?roomDebug=1. Allows clicking anywhere on the model to inspect
 * and copy exact Three.js [x, y, z] coordinates for RoomConfig.
 */

export class Room3DDebug {
  constructor(canvasContainer, scene, camera, THREE) {
    this.container = canvasContainer;
    this.scene = scene;
    this.camera = camera;
    this.THREE = THREE;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.debugIndicator = null;
    this.panel = null;
    this.active = false;
    this.lastPoint = null;

    this.checkQueryParam();
  }

  checkQueryParam() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('roomDebug') === '1' || params.has('roomDebug')) {
      this.enable();
    }
  }

  enable() {
    if (this.active) return;
    this.active = true;

    // Create 3D pin indicator
    const geo = new this.THREE.SphereGeometry(0.04, 16, 16);
    const mat = new this.THREE.MeshBasicMaterial({ color: 0x3ad1c9, wireframe: true });
    this.debugIndicator = new this.THREE.Mesh(geo, mat);
    this.debugIndicator.visible = false;
    this.scene.add(this.debugIndicator);

    // Create DOM panel
    this.panel = document.createElement('div');
    this.panel.className = 'room3d-debug-panel';
    this.panel.innerHTML = `
      <div class="debug-title">
        <span>🛠️ Tọa độ Debug</span>
        <span class="debug-hint">Nhấp chuột lên mô hình</span>
      </div>
      <div class="debug-coords">
        <div>X: <span id="debug-x">--</span></div>
        <div>Y: <span id="debug-y">--</span></div>
        <div>Z: <span id="debug-z">--</span></div>
      </div>
      <div class="debug-actions">
        <button type="button" id="debug-copy-btn" class="debug-btn" disabled>Sao chép [x, y, z]</button>
      </div>
    `;

    this.container.appendChild(this.panel);

    const copyBtn = this.panel.querySelector('#debug-copy-btn');
    copyBtn.addEventListener('click', () => {
      if (this.lastPoint) {
        const text = `[${this.lastPoint.x.toFixed(3)}, ${this.lastPoint.y.toFixed(3)}, ${this.lastPoint.z.toFixed(3)}]`;
        navigator.clipboard?.writeText(text).then(() => {
          copyBtn.textContent = 'Đã chép!';
          setTimeout(() => { copyBtn.textContent = 'Sao chép [x, y, z]'; }, 1500);
        });
      }
    });

    this.container.addEventListener('pointerdown', this.handlePointerDown.bind(this));
    console.log('[Room3D] Debug placement mode enabled (?roomDebug=1)');
  }

  handlePointerDown(event) {
    if (!this.active) return;
    // Don't intercept clicks on markers or debug panel
    if (event.target.closest('.room3d-marker') || event.target.closest('.room3d-debug-panel') || event.target.closest('.room3d-toolbar')) {
      return;
    }

    const rect = this.container.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointer, this.camera);
    const intersects = this.raycaster.intersectObjects(this.scene.children, true);

    const hit = intersects.find(i => i.object !== this.debugIndicator && i.object.type === 'Mesh');
    if (hit) {
      const p = hit.point;
      this.lastPoint = p;
      this.debugIndicator.position.copy(p);
      this.debugIndicator.visible = true;

      this.panel.querySelector('#debug-x').textContent = p.x.toFixed(3);
      this.panel.querySelector('#debug-y').textContent = p.y.toFixed(3);
      this.panel.querySelector('#debug-z').textContent = p.z.toFixed(3);
      this.panel.querySelector('#debug-copy-btn').disabled = false;
    }
  }

  dispose() {
    if (this.debugIndicator) {
      this.scene.remove(this.debugIndicator);
      this.debugIndicator.geometry?.dispose();
      this.debugIndicator.material?.dispose();
    }
    if (this.panel) {
      this.panel.remove();
    }
  }
}
