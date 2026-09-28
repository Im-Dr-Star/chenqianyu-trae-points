'use strict';

const api = window.widgetAPI;
const stageEl = document.getElementById('stage');
const charWrapEl = document.getElementById('charWrap');
const charEl = document.getElementById('character');
const bubbleEl = document.getElementById('bubble');
const textEl = document.getElementById('bubbleText');

let revertTimer = null;

function fmt(n) {
  return Number(n).toLocaleString('en-US');
}

function restartAnimation(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

function render(payload) {
  if (!payload) return;
  clearTimeout(revertTimer);
  bubbleEl.classList.remove('steady', 'decrease', 'increase', 'error', 'loading');

  if (payload.type === 'steady') {
    textEl.textContent = `当前剩余 ${fmt(payload.value)} 积分`;
    bubbleEl.classList.add('steady');
  } else if (payload.type === 'decrease') {
    textEl.textContent = `-${fmt(payload.delta)} 积分`;
    bubbleEl.classList.add('decrease');
    restartAnimation(bubbleEl, 'shake');
    revertTimer = setTimeout(() => render({ type: 'steady', value: payload.value }), payload.alertMs || 5000);
  } else if (payload.type === 'increase') {
    if (payload.enabled === false) {
      render({ type: 'steady', value: payload.value });
      return;
    }
    textEl.textContent = `+${fmt(payload.delta)} 积分`;
    bubbleEl.classList.add('increase');
    revertTimer = setTimeout(() => render({ type: 'steady', value: payload.value }), payload.alertMs || 4000);
  } else if (payload.type === 'error') {
    textEl.textContent = payload.message || '获取失败';
    bubbleEl.classList.add('error');
  } else if (payload.type === 'loading') {
    textEl.textContent = '获取中…';
    bubbleEl.classList.add('loading');
  }
}

api.onPointsUpdate(render);

/* ---------------- 人物图片布局（等比缩放定位，图片文件本身不做任何修改） ---------------- */
let currentLayout = null;

function applyLayout() {
  const info = currentLayout;
  if (!info || !charEl.naturalWidth) return;
  const scale = info.scale || 1;
  charEl.style.width = Math.round(charEl.naturalWidth * scale) + 'px';
  charEl.style.left = Math.round(-info.bbox.x * scale) + 'px';
  charEl.style.top = Math.round(-info.bbox.y * scale) + 'px';
  const cw = Math.round(info.bbox.width * scale);
  const ch = Math.round(info.bbox.height * scale);
  charWrapEl.style.width = cw + 'px';
  charWrapEl.style.height = ch + 'px';
  charWrapEl.style.left = Math.round((stageEl.clientWidth - cw) / 2) + 'px';
  charWrapEl.style.top = info.topZone + 'px';
}

(async function init() {
  const info = await api.getWidgetInfo();
  if (info) {
    currentLayout = info;
    if (charEl.complete && charEl.naturalWidth) applyLayout();
    charEl.addEventListener('load', applyLayout);
  }
  api.onLayoutUpdate((newInfo) => {
    currentLayout = newInfo;
    applyLayout();
  });
  window.addEventListener('resize', applyLayout);
})();

/* ---------------- 点击刷新 / 拖动区分 ---------------- */
const CLICK_THRESHOLD = 4;
let drag = null;

stageEl.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  e.preventDefault();
  drag = { lastX: e.screenX, lastY: e.screenY, moved: false };
});

window.addEventListener('mousemove', (e) => {
  if (!drag) return;
  if (e.buttons === 0) {
    finishDrag(!drag.moved);
    return;
  }
  const dx = e.screenX - drag.lastX;
  const dy = e.screenY - drag.lastY;
  if (!drag.moved && Math.abs(dx) < CLICK_THRESHOLD && Math.abs(dy) < CLICK_THRESHOLD) return;
  drag.moved = true;
  if (dx || dy) api.moveWindowBy(dx, dy);
  drag.lastX = e.screenX;
  drag.lastY = e.screenY;
});

window.addEventListener('mouseup', () => {
  if (!drag) return;
  finishDrag(!drag.moved);
});

window.addEventListener('blur', () => { drag = null; });

function finishDrag(wasClick) {
  drag = null;
  if (wasClick) {
    restartAnimation(charEl, 'clicking');
    restartAnimation(bubbleEl, 'bounce');
    render({ type: 'loading' });
    api.requestRefresh();
  } else {
    api.savePosition();
  }
}

/* ---------------- 右键菜单 ---------------- */
window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  api.showContextMenu();
});
