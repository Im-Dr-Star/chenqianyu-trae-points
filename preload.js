'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('widgetAPI', {
  onPointsUpdate: (cb) => ipcRenderer.on('points-update', (_e, payload) => cb(payload)),
  onConfigUpdated: (cb) => ipcRenderer.on('config-updated', (_e, cfg) => cb(cfg)),
  onLayoutUpdate: (cb) => ipcRenderer.on('layout-update', (_e, info) => cb(info)),
  requestRefresh: () => ipcRenderer.invoke('refresh-points'),
  moveWindowBy: (dx, dy) => ipcRenderer.send('window-move', { dx, dy }),
  savePosition: () => ipcRenderer.send('save-position'),
  showContextMenu: () => ipcRenderer.send('show-context-menu'),
  getWidgetInfo: () => ipcRenderer.invoke('get-widget-info'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveSettings: (partial) => ipcRenderer.invoke('save-settings', partial)
});
