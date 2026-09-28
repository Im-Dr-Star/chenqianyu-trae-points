'use strict';

const api = window.widgetAPI;
const el = (id) => document.getElementById(id);

(async function init() {
  const cfg = await api.getConfig();
  el('interval').value = Math.round(cfg.refreshIntervalMs / 1000);
  el('decrease').value = Math.round(cfg.decreaseAlertMs / 1000);
  el('increase').value = Math.round(cfg.increaseAlertMs / 1000);
  el('green').checked = !!cfg.increaseGreenEnabled;
  el('scale').value = cfg.imageScale;
  el('scaleVal').textContent = Number(cfg.imageScale).toFixed(2);

  let scaleTimer = null;
  el('scale').addEventListener('input', () => {
    el('scaleVal').textContent = Number(el('scale').value).toFixed(2);
    clearTimeout(scaleTimer);
    scaleTimer = setTimeout(() => {
      api.saveSettings({ imageScale: Number(el('scale').value) });
    }, 250);
  });

  const syncIncrease = () => { el('increase').disabled = !el('green').checked; };
  syncIncrease();
  el('green').addEventListener('change', syncIncrease);

  el('save').addEventListener('click', async () => {
    await api.saveSettings({
      refreshIntervalMs: Number(el('interval').value) * 1000,
      decreaseAlertMs: Number(el('decrease').value) * 1000,
      increaseAlertMs: Number(el('increase').value) * 1000,
      increaseGreenEnabled: el('green').checked,
      imageScale: Number(el('scale').value)
    });
    window.close();
  });
})();
