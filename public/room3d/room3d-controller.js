/**
 * LongOS 3D Digital Twin - Controller
 * Implements the lifecycle and public API contract defined in Section 6.2 of Handoff Spec.
 */

import { validateRoomConfig, DEFAULT_ROOM_CONFIG } from './room3d-config.js';
import { Room3DScene } from './room3d-scene.js';

export class Room3DController {
  constructor(canvasContainer, overlayContainer, config, options = {}) {
    this.canvasContainer = canvasContainer;
    this.overlayContainer = overlayContainer;
    this.rawConfig = config || DEFAULT_ROOM_CONFIG;
    this.validatedConfig = validateRoomConfig(this.rawConfig);
    this.options = options;

    this.scene = new Room3DScene(
      this.canvasContainer,
      this.overlayContainer,
      this.validatedConfig,
      options
    );
  }

  setSnapshot(roomSnapshot) {
    if (!roomSnapshot || roomSnapshot.schemaVersion !== 1) {
      console.warn('[Room3D] Invalid RoomSnapshot provided:', roomSnapshot);
      return;
    }
    this.scene.setSnapshot(roomSnapshot);
  }

  setMode(mode) {
    if (!['real', 'data', 'heat'].includes(mode)) {
      console.warn(`[Room3D] Unknown mode: ${mode}`);
      return;
    }
    this.scene.setMode(mode);
  }

  setCameraPreset(presetName) {
    this.scene.setCameraPreset(presetName);
  }

  resize() {
    this.scene.resize();
  }

  pause() {
    this.scene.pause();
  }

  resume() {
    this.scene.resume();
  }

  dispose() {
    this.scene.dispose();
  }
}
