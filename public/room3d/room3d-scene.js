/**
 * LongOS 3D Digital Twin - Scene Engine (Three.js)
 * Manages rendering, lighting, camera controls, procedural fallback, and model loading.
 * Strictly adheres to AD-05 (lazy-load, render-on-demand, battery friendly).
 */

import * as THREE from 'https://esm.sh/three@0.170.0';
import { OrbitControls } from 'https://esm.sh/three@0.170.0/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'https://esm.sh/three@0.170.0/examples/jsm/loaders/GLTFLoader.js';

import { Room3DMarkers } from './room3d-markers.js';
import { Room3DHeatmap } from './room3d-heatmap.js';
import { Room3DDebug } from './room3d-debug.js';

export class Room3DScene {
  constructor(canvasContainer, overlayContainer, config, options = {}) {
    this.canvasContainer = canvasContainer;
    this.overlayContainer = overlayContainer;
    this.config = config;
    this.options = options;

    this.THREE = THREE;
    this.isDisposed = false;
    this.isPaused = false;
    this.needsRender = true;
    this.mode = 'real'; // 'real' | 'data' | 'heat'

    this.markers = new Room3DMarkers(this.overlayContainer, {
      onSelect: (item) => this.options.onSelect?.(item)
    });
    this.heatmap = new Room3DHeatmap(this.config);
    this.heatPlane = null;
    this.roomMeshGroup = new THREE.Group();

    this.initScene();
    this.initControls();
    this.initLighting();
    this.markers.initMarkers(this.config, this.camera);
    this.debug = new Room3DDebug(this.overlayContainer, this.scene, this.camera, THREE);

    this.setupResizeObserver();
    this.loadModelOrProcedural(this.config.model?.defaultModelUrl || options.modelUrl);

    this.animate = this.animate.bind(this);
    this.animationFrameId = requestAnimationFrame(this.animate);
  }

  initScene() {
    const width = this.canvasContainer.clientWidth || 600;
    const height = this.canvasContainer.clientHeight || 450;

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 50);
    const defaultPos = this.config.camera?.presets?.overview?.position || [3.4, 2.6, 3.8];
    const defaultTarget = this.config.camera?.presets?.overview?.target || [0, 0.8, 0];
    this.camera.position.set(...defaultPos);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.canvasContainer.appendChild(this.renderer.domElement);
    this.scene.add(this.roomMeshGroup);
  }

  initControls() {
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02; // Prevent going under floor
    this.controls.minDistance = 1.2;
    this.controls.maxDistance = 10.0;
    const defaultTarget = this.config.camera?.presets?.overview?.target || [0, 0.8, 0];
    this.controls.target.set(...defaultTarget);

    this.controls.addEventListener('change', () => {
      this.needsRender = true;
    });
  }

  initLighting() {
    const ambient = new THREE.AmbientLight(0xdbeafe, 0.95);
    this.scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(4, 7, 3);
    this.scene.add(dirLight);

    const softFill = new THREE.DirectionalLight(0x3ad1c9, 0.4);
    softFill.position.set(-4, 3, -3);
    this.scene.add(softFill);
  }

  loadModelOrProcedural(modelUrl) {
    if (modelUrl) {
      this.loadGLB(modelUrl);
    } else {
      this.buildProceduralRoom();
    }
  }

  loadGLB(url) {
    const loader = new GLTFLoader();
    this.options.onLoading?.(true, 0);

    loader.load(
      url,
      (gltf) => {
        if (this.isDisposed) return;
        this.clearRoomMesh();
        const root = gltf.scene;

        // Auto compute bounding box and scale if needed
        const box = new THREE.Box3().setFromObject(root);
        const center = box.getCenter(new THREE.Vector3());
        root.position.sub(center); // Center to origin
        root.position.y += box.getSize(new THREE.Vector3()).y / 2;

        this.roomMeshGroup.add(root);
        this.needsRender = true;
        this.options.onLoading?.(false, 100);
      },
      (xhr) => {
        if (xhr.lengthComputable) {
          const percent = (xhr.loaded / xhr.total) * 100;
          this.options.onLoading?.(true, percent);
        }
      },
      (error) => {
        console.warn('[Room3D] Error loading GLB, falling back to procedural room:', error);
        this.buildProceduralRoom();
        this.options.onLoading?.(false, 100, error);
      }
    );
  }

  buildProceduralRoom() {
    this.clearRoomMesh();

    const floorGeo = new THREE.PlaneGeometry(4.2, 4.0);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x141a24,
      roughness: 0.8,
      metalness: 0.2
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.roomMeshGroup.add(floor);

    // Subtle grid overlay
    const gridHelper = new THREE.GridHelper(4.2, 14, 0x3ad1c9, 0x223046);
    gridHelper.position.y = 0.005;
    this.roomMeshGroup.add(gridHelper);

    // Back wall
    const backWallGeo = new THREE.PlaneGeometry(4.2, 2.4);
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x10151f,
      roughness: 0.9,
      side: THREE.DoubleSide
    });
    const backWall = new THREE.Mesh(backWallGeo, wallMat);
    backWall.position.set(0, 1.2, -2.0);
    this.roomMeshGroup.add(backWall);

    // Left wall
    const leftWallGeo = new THREE.PlaneGeometry(4.0, 2.4);
    const leftWall = new THREE.Mesh(leftWallGeo, wallMat);
    leftWall.position.set(-2.1, 1.2, 0);
    leftWall.rotation.y = Math.PI / 2;
    this.roomMeshGroup.add(leftWall);

    // Furniture: Desk
    const deskMat = new THREE.MeshStandardMaterial({ color: 0x1f293d, roughness: 0.5 });
    const deskTop = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.05, 0.65), deskMat);
    deskTop.position.set(1.1, 0.72, -0.6);
    this.roomMeshGroup.add(deskTop);

    // Desk legs
    const legGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.72);
    const legMat = new THREE.MeshStandardMaterial({ color: 0x374151 });
    const leg1 = new THREE.Mesh(legGeo, legMat);
    leg1.position.set(0.6, 0.36, -0.4);
    const leg2 = new THREE.Mesh(legGeo, legMat);
    leg2.position.set(1.6, 0.36, -0.4);
    const leg3 = new THREE.Mesh(legGeo, legMat);
    leg3.position.set(0.6, 0.36, -0.85);
    const leg4 = new THREE.Mesh(legGeo, legMat);
    leg4.position.set(1.6, 0.36, -0.85);
    this.roomMeshGroup.add(leg1, leg2, leg3, leg4);

    // Furniture: Bed
    const bedMat = new THREE.MeshStandardMaterial({ color: 0x22324d, roughness: 0.9 });
    const bedMesh = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.45, 1.8), bedMat);
    bedMesh.position.set(-1.2, 0.225, 0.7);
    this.roomMeshGroup.add(bedMesh);

    // Pillow
    const pillowMat = new THREE.MeshStandardMaterial({ color: 0x3b5072 });
    const pillow = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.1, 0.35), pillowMat);
    pillow.position.set(-1.2, 0.5, -0.05);
    this.roomMeshGroup.add(pillow);

    // AC Unit on wall
    const acMat = new THREE.MeshStandardMaterial({ color: 0x2a3547 });
    const acMesh = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.25, 0.2), acMat);
    acMesh.position.set(0, 2.1, -1.9);
    this.roomMeshGroup.add(acMesh);

    // SHT30 physical sensor housing representation
    const sensorGeo = new THREE.BoxGeometry(0.08, 0.04, 0.06);
    const sensorMat = new THREE.MeshStandardMaterial({ color: 0x3ad1c9, emissive: 0x0f8b8d, emissiveIntensity: 0.5 });
    const sensorMesh = new THREE.Mesh(sensorGeo, sensorMat);
    sensorMesh.position.set(1.1, 0.765, -0.6);
    this.roomMeshGroup.add(sensorMesh);

    this.needsRender = true;
    this.options.onLoading?.(false, 100);
  }

  clearRoomMesh() {
    while (this.roomMeshGroup.children.length > 0) {
      const obj = this.roomMeshGroup.children[0];
      this.roomMeshGroup.remove(obj);
      obj.geometry?.dispose();
      if (Array.isArray(obj.material)) {
        obj.material.forEach(m => m.dispose());
      } else {
        obj.material?.dispose();
      }
    }
  }

  setupResizeObserver() {
    this.resizeObserver = new ResizeObserver(() => {
      this.resize();
    });
    this.resizeObserver.observe(this.canvasContainer);
  }

  resize() {
    if (this.isDisposed) return;
    const width = this.canvasContainer.clientWidth;
    const height = this.canvasContainer.clientHeight;
    if (width === 0 || height === 0) return;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.needsRender = true;
  }

  setMode(mode) {
    this.mode = mode;
    if (mode === 'heat') {
      this.updateHeatmap();
    } else {
      if (this.heatPlane) {
        this.heatPlane.visible = false;
      }
    }
    this.needsRender = true;
  }

  setSnapshot(snapshot) {
    this.lastSnapshot = snapshot;
    this.markers.updateSnapshot(snapshot);
    if (this.mode === 'heat') {
      this.updateHeatmap();
    }
    this.needsRender = true;
  }

  updateHeatmap() {
    if (!this.lastSnapshot) return;
    const sensors = this.lastSnapshot.sensors || {};
    const status = this.heatmap.getEligibilityStatus(sensors, this.lastSnapshot);

    this.options.onHeatmapStatus?.(status);

    if (!status.enabled) {
      if (this.heatPlane) this.heatPlane.visible = false;
      return;
    }

    // Combine config coordinates with snapshot values
    const sensorsWithCoords = [];
    for (const s of (this.config.sensors || [])) {
      const live = sensors[s.id];
      if (live && live.online && typeof live.temperatureC === 'number') {
        sensorsWithCoords.push({
          x: s.position[0],
          z: s.position[2],
          temperatureC: live.temperatureC
        });
      }
    }

    if (sensorsWithCoords.length < 3) {
      if (this.heatPlane) this.heatPlane.visible = false;
      return;
    }

    const canvas = this.heatmap.computeGrid(sensorsWithCoords);
    if (!this.heatPlane) {
      const { minX, maxX, minZ, maxZ } = this.heatmap.extents;
      const w = maxX - minX;
      const h = maxZ - minZ;
      const geo = new THREE.PlaneGeometry(w, h);
      const texture = new THREE.CanvasTexture(canvas);
      const mat = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: 0.65,
        side: THREE.DoubleSide
      });
      this.heatPlane = new THREE.Mesh(geo, mat);
      this.heatPlane.rotation.x = -Math.PI / 2;
      this.heatPlane.position.set((minX + maxX) / 2, this.heatmap.planeY, (minZ + maxZ) / 2);
      this.scene.add(this.heatPlane);
    } else {
      this.heatPlane.material.map.needsUpdate = true;
      this.heatPlane.visible = true;
    }
  }

  setCameraPreset(name) {
    const preset = this.config.camera?.presets?.[name];
    if (!preset) return;
    this.camera.position.set(...preset.position);
    this.controls.target.set(...preset.target);
    this.controls.update();
    this.needsRender = true;
  }

  pause() {
    this.isPaused = true;
  }

  resume() {
    this.isPaused = false;
    this.needsRender = true;
  }

  animate() {
    if (this.isDisposed) return;
    this.animationFrameId = requestAnimationFrame(this.animate);

    if (this.isPaused) return;

    // Check if controls updated camera
    const controlsUpdated = this.controls.update();
    if (controlsUpdated || this.needsRender) {
      this.renderer.render(this.scene, this.camera);
      const width = this.canvasContainer.clientWidth;
      const height = this.canvasContainer.clientHeight;
      this.markers.updatePositions(this.camera, width, height, this.THREE);
      this.needsRender = false;
    }
  }

  dispose() {
    this.isDisposed = true;
    cancelAnimationFrame(this.animationFrameId);
    this.resizeObserver?.disconnect();
    this.markers.dispose();
    this.debug.dispose();
    this.controls.dispose();
    this.clearRoomMesh();
    if (this.heatPlane) {
      this.scene.remove(this.heatPlane);
      this.heatPlane.geometry.dispose();
      this.heatPlane.material.map?.dispose();
      this.heatPlane.material.dispose();
    }
    this.renderer.dispose();
    this.canvasContainer.innerHTML = '';
  }
}
