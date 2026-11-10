/**
 * LongOS 3D Digital Twin - Entry Point
 * Public ESM Entry for dynamic import from public/index.html.
 */

import { Room3DController } from './room3d-controller.js';
import { toRoomSnapshot } from './room3d-data-adapter.js';
import { DEFAULT_ROOM_CONFIG } from './room3d-config.js';

export const Room3D = {
  version: '1.0.0',
  defaultConfig: DEFAULT_ROOM_CONFIG,
  toRoomSnapshot,

  async create(options = {}) {
    const {
      container,
      config,
      modelUrl,
      onHotspotSelect,
      onDebugPosition,
      onLoading,
      onHeatmapStatus
    } = options;

    if (!container || !(container instanceof HTMLElement)) {
      throw new Error('[Room3D] create() requires a valid container HTMLElement');
    }

    container.classList.add('room3d-root');

    // Create or reuse internal containers
    let canvasContainer = container.querySelector('.room3d-canvas-wrap');
    if (!canvasContainer) {
      canvasContainer = document.createElement('div');
      canvasContainer.className = 'room3d-canvas-wrap';
      container.appendChild(canvasContainer);
    }

    let overlayContainer = container.querySelector('.room3d-overlay-wrap');
    if (!overlayContainer) {
      overlayContainer = document.createElement('div');
      overlayContainer.className = 'room3d-overlay-wrap';
      container.appendChild(overlayContainer);
    }

    const controller = new Room3DController(
      canvasContainer,
      overlayContainer,
      config,
      {
        modelUrl,
        onSelect: onHotspotSelect,
        onDebugPosition,
        onLoading,
        onHeatmapStatus
      }
    );

    return controller;
  }
};

export default Room3D;
