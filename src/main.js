import * as THREE from "three";
import {
  IdleAnimation,
  NameTagObject,
  RunningAnimation,
  SkinViewer,
  WalkingAnimation,
} from "skinview3d";
import "./style.css";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const elements = {
  form: $("#searchForm"),
  username: $("#username"),
  searchBtn: $("#searchBtn"),
  studio: $("#studio"),
  stage: $("#viewerStage"),
  canvas: $("#skinCanvas"),
  loadingState: $("#loadingState"),
  loadingText: $("#loadingText"),
  emptyState: $("#emptyState"),
  profilePlaceholder: $("#profilePlaceholder"),
  profileContent: $("#profileContent"),
  playerName: $("#playerName"),
  playerHead: $("#playerHead"),
  uuidText: $("#uuidText"),
  uuidButton: $("#copyUuidBtn"),
  copyUuidAction: $("#copyUuidAction"),
  modelValue: $("#modelValue"),
  formatValue: $("#formatValue"),
  textureImg: $("#textureImg"),
  textureSize: $("#textureSize"),
  downloadBtn: $("#downloadBtn"),
  capeCard: $("#capeCard"),
  capeImg: $("#capeImg"),
  capeDownload: $("#capeDownload"),
  viewerBadgeText: $("#viewerBadgeText"),
  viewerHint: $("#viewerHint"),
  viewerHintText: $("#viewerHintText"),
  recentList: $("#recentList"),
  clearHistoryBtn: $("#clearHistoryBtn"),
  autoRotateBtn: $("#autoRotateBtn"),
  resetBtn: $("#resetBtn"),
  bgmToggle: $("#bgmToggle"),
  bgmAudio: $("#bgmAudio"),
  squashModeSwitch: $("#squashModeSwitch"),
  autoSquashInterval: $("#autoSquashInterval"),
  toast: $("#toast"),
};

const HISTORY_KEY = "skinlab:recent";
const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,16}$/;
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const SQUASH_WIDTH = 4 / 3;
const SQUASH_HEIGHT = 2 / 3;
const SQUASH_DURATION = 300;
const AUTO_SQUASH_MIN_INTERVAL = 100;
const AUTO_SQUASH_MAX_INTERVAL = 500;
const AUTO_SQUASH_DEFAULT_INTERVAL = 300;
const AUTO_SQUASH_MAX_DURATION = 180;
const BASE_FOOT_Y = -24;
const SQUASH_HINT = "拖动旋转 · 滚轮缩放 · 点击人物压扁/复原";
const pointerNdc = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
let pointerStart = null;

const state = {
  viewer: null,
  profile: null,
  requestId: 0,
  loading: false,
  animation: "idle",
  autoRotate: !prefersReducedMotion,
  history: readHistory(),
  toastTimer: null,
  skinDimensions: null,
  squashed: false,
  squashMode: "manual",
  autoSquashInterval: AUTO_SQUASH_DEFAULT_INTERVAL,
  autoSquashTimer: null,
  squashTimer: null,
  squashFrame: null,
  baseFootY: null,
  bgmOn: false,
  bgmBusy: false,
};

const animations = {
  idle: new IdleAnimation(),
  walk: new WalkingAnimation(),
  run: new RunningAnimation(),
};
animations.walk.speed = 0.7;
animations.walk.headBobbing = true;
animations.run.speed = 1.15;

function readHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(parsed)
      ? parsed.filter((name) => typeof name === "string").slice(0, 6)
      : [];
  } catch {
    return [];
  }
}

function writeHistory() {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history.slice(0, 6)));
  } catch {
    // localStorage can be unavailable in private contexts; history is optional.
  }
}

function addHistory(name) {
  state.history = [
    name,
    ...state.history.filter((item) => item.toLowerCase() !== name.toLowerCase()),
  ].slice(0, 6);
  writeHistory();
  renderHistory();
}

function renderHistory() {
  elements.recentList.replaceChildren();
  for (const name of state.history) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "recent-item";
    button.textContent = name;
    button.addEventListener("click", () => {
      if (state.loading) return;
      elements.username.value = name;
      loadPlayer(name, { updateUrl: true, scroll: true });
    });
    elements.recentList.append(button);
  }
}

function showToast(message, tone = "success") {
  window.clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle("is-error", tone === "error");
  elements.toast.classList.add("is-visible");
  state.toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove("is-visible");
  }, tone === "error" ? 4200 : 2600);
}

function setLoading(active, message = "正在连接 Mojang…") {
  state.loading = active;
  elements.searchBtn.disabled = active;
  elements.stage.setAttribute("aria-busy", String(active));
  elements.loadingText.textContent = message;

  if (active) {
    elements.emptyState.hidden = true;
    elements.loadingState.classList.remove("is-done");
    elements.stage.classList.add("is-loading");
  } else {
    elements.loadingState.classList.add("is-done");
    elements.stage.classList.remove("is-loading");
    if (!state.profile) {
      elements.emptyState.hidden = false;
    }
  }

  for (const button of $$(".quick-name")) {
    button.disabled = active;
  }
}

function showEmpty(message) {
  const title = elements.emptyState.querySelector("strong");
  const description = elements.emptyState.querySelector("p");
  if (message) {
    title.textContent = "没有找到这位玩家";
    description.textContent = message;
  } else {
    title.textContent = "等待召唤";
    description.textContent = "输入一个正版 ID，让方块人登场。";
  }
  elements.emptyState.hidden = false;
  elements.profilePlaceholder.hidden = false;
  elements.profileContent.hidden = true;
}

function createViewer() {
  try {
    const width = Math.max(320, elements.stage.clientWidth);
    const height = Math.max(360, elements.stage.clientHeight);
    const viewer = new SkinViewer({
      canvas: elements.canvas,
      width,
      height,
      model: "auto-detect",
      background: null,
      fov: 42,
      zoom: 0.8,
      enableControls: true,
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
      preserveDrawingBuffer: false,
    });

    viewer.controls.enablePan = false;
    viewer.controls.enableDamping = true;
    viewer.controls.dampingFactor = 0.08;
    viewer.controls.zoomSpeed = 0.75;
    viewer.controls.rotateSpeed = 0.7;
    viewer.autoRotate = state.autoRotate;
    viewer.autoRotateSpeed = 0.55;
    viewer.animation = animations.idle;
    viewer.globalLight.intensity = 2.7;

    // A faint lime rim light separates dark skins from the dark stage.
    const rimLight = new THREE.DirectionalLight(0xc8ff7d, 0.55);
    rimLight.position.set(-5, 4, -6);
    viewer.scene.add(rimLight);

    const warmFill = new THREE.DirectionalLight(0xffc98d, 0.2);
    warmFill.position.set(5, 1, 4);
    viewer.scene.add(warmFill);

    state.viewer = viewer;

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width: nextWidth, height: nextHeight } = entry.contentRect;
      if (nextWidth < 10 || nextHeight < 10) return;
      viewer.setSize(Math.round(nextWidth), Math.round(nextHeight));
    });
    resizeObserver.observe(elements.stage);

    return viewer;
  } catch (error) {
    console.error(error);
    setLoading(false);
    showEmpty("当前浏览器无法启动 WebGL，请尝试更新浏览器或开启硬件加速。");
    showToast("WebGL 初始化失败", "error");
    return null;
  }
}

function updateModelLabel() {
  if (!state.viewer) return;
  const model = state.viewer.playerObject.skin.modelType;
  const isSlim = model === "slim";
  elements.modelValue.textContent = isSlim ? "SLIM" : "CLASSIC";
  elements.modelValue.title = isSlim ? "Slim（细手臂模型）" : "Classic（标准手臂模型）";
}

function updatePlayerHeadCrop() {
  const dimensions = state.skinDimensions;
  if (!dimensions) return;
  const size = elements.playerHead.clientWidth;
  if (!size) return;
  const ratio = dimensions.height / dimensions.width;
  const scaled = size * 8;
  const background = `url("${state.profile?.skinUrl}")`;
  elements.playerHead.style.backgroundImage = `${background}, ${background}`;
  elements.playerHead.style.backgroundSize = `${scaled}px ${scaled * ratio}px, ${scaled}px ${scaled * ratio}px`;
  elements.playerHead.style.backgroundPosition = `${-size}px ${-size}px, ${-size * 5}px ${-size}px`;
}

function formatBadgeName(name) {
  return name.length > 16 ? `${name.slice(0, 14)}…` : name;
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function updateSquashVisual(widthScale, heightScale) {
  const viewer = state.viewer;
  if (!viewer) return;

  const baseFootY = state.baseFootY ?? BASE_FOOT_Y;
  const footOffset = baseFootY * (1 - heightScale);

  viewer.playerObject.scale.set(widthScale, heightScale, 1);
  viewer.playerWrapper.position.y = footOffset;

  if (viewer.nameTag) {
    // skinview3d positions the tag from the head's world position every frame.
    // Compensate for the wrapper's floor offset so the tag stays above the head.
    const tagOffset = 16 + 4 * heightScale - footOffset;
    viewer.nameTagYOffset = tagOffset;
    viewer.nameTag.position.y = footOffset + tagOffset - 8;
  }
}

function animateSquashTo(widthScale, heightScale, duration = SQUASH_DURATION) {
  const viewer = state.viewer;
  if (!viewer) return;

  if (state.squashFrame !== null) {
    cancelAnimationFrame(state.squashFrame);
    state.squashFrame = null;
  }

  const startWidth = viewer.playerObject.scale.x || 1;
  const startHeight = viewer.playerObject.scale.y || 1;
  const same =
    Math.abs(startWidth - widthScale) < 0.001 &&
    Math.abs(startHeight - heightScale) < 0.001;

  if (prefersReducedMotion || same) {
    updateSquashVisual(widthScale, heightScale);
    return;
  }

  const startedAt = performance.now();
  const tick = (now) => {
    const t = Math.min(1, (now - startedAt) / duration);
    const eased = easeInOutCubic(t);
    updateSquashVisual(
      startWidth + (widthScale - startWidth) * eased,
      startHeight + (heightScale - startHeight) * eased,
    );

    if (t < 1) {
      state.squashFrame = requestAnimationFrame(tick);
    } else {
      state.squashFrame = null;
      updateSquashVisual(widthScale, heightScale);
    }
  };

  state.squashFrame = requestAnimationFrame(tick);
}

function applySquash({ animate = true } = {}) {
  const viewer = state.viewer;
  if (!viewer) return;

  const squashed = state.squashed;
  const widthScale = squashed ? SQUASH_WIDTH : 1;
  const heightScale = squashed ? SQUASH_HEIGHT : 1;

  if (!squashed && state.baseFootY === null) {
    if (state.squashFrame !== null) {
      cancelAnimationFrame(state.squashFrame);
      state.squashFrame = null;
    }
    updateSquashVisual(1, 1);
    const bounds = new THREE.Box3().setFromObject(viewer.playerObject);
    if (Number.isFinite(bounds.min.y)) {
      state.baseFootY = bounds.min.y;
    }
  }

  if (animate) {
    const duration =
      state.squashMode === "auto"
        ? getAutoSquashDuration()
        : SQUASH_DURATION;
    animateSquashTo(widthScale, heightScale, duration);
  } else {
    if (state.squashFrame !== null) {
      cancelAnimationFrame(state.squashFrame);
      state.squashFrame = null;
    }
    updateSquashVisual(widthScale, heightScale);
  }

  updateSquashChrome();
}

function updateSquashChrome() {
  const auto = state.squashMode === "auto";
  const seconds = (getAutoSquashInterval() / 1000).toFixed(1);
  elements.stage.dataset.squash = state.squashed ? "1" : "0";
  elements.stage.dataset.squashMode = auto ? "auto" : "manual";
  elements.viewerHint.classList.toggle("is-active", state.squashed || auto);
  elements.viewerHintText.textContent = auto
    ? `自动循环 ${seconds}s：压扁 ↔ 复原`
    : state.squashed
      ? "已压扁 · 再点一次复原"
      : SQUASH_HINT;
}

function stopAutoSquash() {
  if (state.autoSquashTimer !== null) {
    window.clearTimeout(state.autoSquashTimer);
    state.autoSquashTimer = null;
  }
}

function getAutoSquashInterval() {
  const value = Number(state.autoSquashInterval);
  if (!Number.isFinite(value)) return AUTO_SQUASH_DEFAULT_INTERVAL;
  return Math.min(
    AUTO_SQUASH_MAX_INTERVAL,
    Math.max(AUTO_SQUASH_MIN_INTERVAL, Math.round(value)),
  );
}

function getAutoSquashDuration() {
  return Math.min(
    AUTO_SQUASH_MAX_DURATION,
    Math.max(60, Math.round(getAutoSquashInterval() / 2)),
  );
}

function restartAutoSquash() {
  stopAutoSquash();
  if (
    state.squashMode !== "auto" ||
    state.loading ||
    !state.profile ||
    !state.viewer
  ) {
    return;
  }

  applySquash();
  state.autoSquashTimer = window.setTimeout(
    autoSquashTick,
    getAutoSquashInterval(),
  );
}

function autoSquashTick() {
  if (
    state.squashMode !== "auto" ||
    state.loading ||
    !state.profile ||
    !state.viewer
  ) {
    return;
  }

  state.squashed = !state.squashed;
  applySquash();
  pulseSquashRing();
  state.autoSquashTimer = window.setTimeout(
    autoSquashTick,
    getAutoSquashInterval(),
  );
}

function startAutoSquash() {
  stopAutoSquash();
  if (
    state.squashMode !== "auto" ||
    state.loading ||
    !state.profile ||
    !state.viewer
  ) {
    return;
  }
  autoSquashTick();
}

function setSquashMode(mode, { announce = true } = {}) {
  if (!["manual", "auto"].includes(mode) || state.squashMode === mode) return;

  state.squashMode = mode;
  const auto = mode === "auto";
  elements.squashModeSwitch.classList.toggle("is-auto", auto);
  elements.autoSquashInterval.classList.toggle("is-active", auto);
  for (const button of $$("#squashModeSwitch [data-mode]")) {
    const active = button.dataset.mode === mode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }

  if (auto) {
    startAutoSquash();
  } else {
    stopAutoSquash();
  }
  updateSquashChrome();

  if (announce) {
    showToast(auto ? "自动循环已开启" : "已切换到手动变形");
  }
}

function pulseSquashRing() {
  elements.stage.classList.remove("is-squashing");
  void elements.stage.offsetWidth;
  elements.stage.classList.add("is-squashing");
  window.clearTimeout(state.squashTimer);
  state.squashTimer = window.setTimeout(() => {
    elements.stage.classList.remove("is-squashing");
  }, 300);
}

function squashPlayer() {
  if (
    state.squashMode !== "manual" ||
    !state.profile ||
    !state.viewer ||
    state.loading
  ) {
    return;
  }

  state.squashed = !state.squashed;
  applySquash();
  pulseSquashRing();

  showToast(
    state.squashed
      ? "宽 +1/3 · 高 −1/3，再点一次恢复原比例"
      : "已恢复原始比例",
  );
}

function isObjectVisible(object) {
  for (let node = object; node; node = node.parent) {
    if (!node.visible) return false;
  }
  return true;
}

function isPointOnPlayer(clientX, clientY) {
  const viewer = state.viewer;
  if (!viewer) return false;

  const rect = viewer.canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return false;

  pointerNdc.set(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  );
  raycaster.setFromCamera(pointerNdc, viewer.camera);
  const hits = raycaster.intersectObject(viewer.playerObject, true);
  return hits.some((hit) => hit.object.isMesh && isObjectVisible(hit.object));
}

async function applyProfile(profile, options = {}) {
  const viewer = state.viewer;
  if (!viewer) return;

  stopAutoSquash();
  state.squashed = false;
  applySquash({ animate: false });

  const skinImage = new Image();
  skinImage.decoding = "async";
  const skinReady = new Promise((resolve, reject) => {
    skinImage.onload = resolve;
    skinImage.onerror = () => reject(new Error("皮肤纹理加载失败"));
    skinImage.src = profile.skinUrl;
  });

  elements.loadingText.textContent = "正在搭建方块人…";
  await viewer.loadSkin(profile.skinUrl, {
    model: profile.model || "auto-detect",
    ears: false,
  });
  await skinReady;

  if (profile.hasCape && profile.capeUrl) {
    try {
      await viewer.loadCape(profile.capeUrl);
      viewer.playerObject.backEquipment = "cape";
    } catch {
      viewer.loadCape(null);
    }
  } else {
    viewer.loadCape(null);
  }
  const capeLoaded = viewer.playerObject.cape.visible;

  state.profile = profile;
  updateModelLabel();

  await document.fonts.load("48px Minecraft").catch(() => {});
  viewer.nameTag = new NameTagObject(profile.name, {
    font: "48px Minecraft",
    textStyle: "#eaffc9",
    backgroundStyle: "rgba(5, 9, 6, 0.68)",
    height: 2.8,
  });

  elements.playerName.textContent = profile.name;
  elements.uuidText.textContent = profile.uuid;
  elements.uuidButton.title = `复制 UUID：${profile.uuid}`;
  elements.playerHead.classList.add("is-loaded");
  elements.playerHead.title = `${profile.name} 的皮肤头像`;
  state.skinDimensions = {
    width: skinImage.naturalWidth,
    height: skinImage.naturalHeight,
  };
  updatePlayerHeadCrop();
  elements.formatValue.textContent = `${skinImage.naturalWidth} × ${skinImage.naturalHeight}`;
  elements.textureSize.textContent = `${skinImage.naturalWidth} × ${skinImage.naturalHeight}`;

  elements.textureImg.src = profile.skinUrl;
  elements.textureImg.alt = `${profile.name} 的原始皮肤纹理`;
  elements.downloadBtn.href = `/api/skin/${encodeURIComponent(profile.name)}?download=1`;
  elements.downloadBtn.setAttribute("download", `${profile.name}_skin.png`);

  elements.capeCard.hidden = !capeLoaded;
  if (capeLoaded) {
    elements.capeImg.src = profile.capeUrl;
    elements.capeImg.alt = `${profile.name} 的披风纹理`;
    elements.capeDownload.href = `/api/cape/${encodeURIComponent(profile.name)}?download=1`;
    elements.capeDownload.setAttribute("download", `${profile.name}_cape.png`);
  }

  elements.viewerBadgeText.textContent = `${options.demo ? "示例" : "MOJANG"} / ${formatBadgeName(profile.name).toUpperCase()}`;
  elements.profilePlaceholder.hidden = true;
  elements.profileContent.hidden = false;

  elements.playerName.classList.remove("is-swapping");
  requestAnimationFrame(() => elements.playerName.classList.add("is-swapping"));

  document.title = `${profile.name} 的 3D 皮肤 — SKINLAB`;
  elements.username.value = options.demo ? "" : profile.name;

  if (options.updateUrl !== false) {
    const url = new URL(window.location.href);
    url.searchParams.set("u", profile.name);
    window.history.replaceState(null, "", url);
  }

  viewer.playerWrapper.rotation.y = -0.36;
  viewer.resetCameraPose();
  viewer.zoom = 0.8;
  viewer.animation = animations[state.animation] || animations.idle;
  viewer.autoRotate = state.autoRotate;
  state.baseFootY = null;
  applySquash({ animate: false });

  if (state.squashMode === "auto") {
    state.autoSquashTimer = window.setTimeout(autoSquashTick, 260);
  }
}

async function loadPlayer(name, options = {}) {
  const username = String(name || "").trim();
  if (!USERNAME_PATTERN.test(username)) {
    showToast("请输入 3–16 位 Java 正版 ID（字母、数字或下划线）。", "error");
    elements.username.focus();
    return;
  }

  const requestId = ++state.requestId;
  setLoading(true, "正在连接 Mojang…");
  elements.username.value = username;
  if (options.scroll) {
    elements.studio.scrollIntoView({
      behavior: prefersReducedMotion ? "auto" : "smooth",
      block: "start",
    });
  }

  try {
    const response = await fetch(`/api/profile?username=${encodeURIComponent(username)}`, {
      headers: { Accept: "application/json" },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error?.message || `查询失败（HTTP ${response.status}）`);
    }
    if (requestId !== state.requestId) return;

    elements.loadingText.textContent = "正在解析皮肤纹理…";
    await applyProfile(payload.profile, options);

    if (requestId !== state.requestId) return;
    if (!options.demo) {
      addHistory(payload.profile.name);
    }
    setLoading(false);
    if (!options.demo) {
      showToast(`已召唤 ${payload.profile.name}，拖动模型试试看。`);
    }
  } catch (error) {
    if (requestId !== state.requestId) return;
    console.error(error);
    setLoading(false);
    if (!state.profile) {
      showEmpty(error.message);
    }
    showToast(error.message || "查询失败，请稍后再试。", "error");
  }
}

async function copyUuid() {
  if (!state.profile) return;
  const value = state.profile.uuid;
  try {
    await navigator.clipboard.writeText(value);
    showToast("UUID 已复制到剪贴板");
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    try {
      document.execCommand("copy");
      showToast("UUID 已复制到剪贴板");
    } catch {
      showToast("复制失败，请手动选择 UUID。", "error");
    }
    textarea.remove();
  }
}

function setAnimation(name) {
  const animation = animations[name];
  if (!animation || !state.viewer) return;
  state.animation = name;
  state.viewer.animation = animation;
  for (const button of $$(".segmented button")) {
    const active = button.dataset.animation === name;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }
}

function toggleAutoRotate() {
  if (!state.viewer) return;
  state.autoRotate = !state.autoRotate;
  state.viewer.autoRotate = state.autoRotate;
  elements.autoRotateBtn.classList.toggle("is-on", state.autoRotate);
  elements.autoRotateBtn.setAttribute("aria-pressed", String(state.autoRotate));
}

function setBgmUi(on) {
  state.bgmOn = on;
  elements.bgmToggle.classList.toggle("is-on", on);
  elements.bgmToggle.setAttribute("aria-pressed", String(on));
  elements.bgmToggle.setAttribute(
    "aria-label",
    on ? "关闭 BGM" : "播放 BGM：朋友的酒 DJ版",
  );
}

async function toggleBgm() {
  if (state.bgmBusy) return;

  if (state.bgmOn) {
    elements.bgmAudio.pause();
    setBgmUi(false);
    showToast("BGM 已关闭");
    return;
  }

  state.bgmBusy = true;
  elements.bgmToggle.setAttribute("aria-busy", "true");
  try {
    if (elements.bgmAudio.error) {
      elements.bgmAudio.load();
    }
    await elements.bgmAudio.play();
    setBgmUi(true);
    showToast("BGM 已开启：朋友的酒 DJ版");
  } catch {
    const missing = Boolean(elements.bgmAudio.error);
    setBgmUi(false);
    showToast(
      missing
        ? "未找到 BGM 文件。请将音频放到 public/audio/friends-wine-dj.mp3"
        : "BGM 播放被浏览器拦截，请再点一次开关。",
      "error",
    );
  } finally {
    state.bgmBusy = false;
    elements.bgmToggle.removeAttribute("aria-busy");
  }
}

function resetView() {
  if (!state.viewer) return;
  stopAutoSquash();
  state.squashed = false;
  state.viewer.playerWrapper.rotation.set(0, 0, 0);
  state.viewer.resetCameraPose();
  state.viewer.zoom = 0.8;
  state.viewer.animation = animations[state.animation] || animations.idle;
  applySquash();
  if (state.squashMode === "auto") {
    state.autoSquashTimer = window.setTimeout(
      autoSquashTick,
      getAutoSquashInterval(),
    );
  }
  showToast("视角与体型已复位");
}

/* ── Events ───────────────────────────────────────────── */

elements.canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || event.isPrimary === false) return;
  pointerStart = {
    x: event.clientX,
    y: event.clientY,
    time: performance.now(),
    pointerId: event.pointerId,
  };
});

elements.canvas.addEventListener("pointerup", (event) => {
  if (!pointerStart || pointerStart.pointerId !== event.pointerId) {
    pointerStart = null;
    return;
  }

  const start = pointerStart;
  pointerStart = null;
  if (state.loading || !state.profile) return;
  if (performance.now() - start.time > 800) return;
  if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 7) return;
  if (!isPointOnPlayer(event.clientX, event.clientY)) return;

  squashPlayer();
});

elements.canvas.addEventListener("pointercancel", () => {
  pointerStart = null;
});

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (state.loading) return;
  loadPlayer(elements.username.value, { updateUrl: true, scroll: true });
});

for (const button of $$(".quick-name")) {
  button.addEventListener("click", () => {
    if (state.loading) return;
    const name = button.dataset.name;
    if (!name) return;
    elements.username.value = name;
    loadPlayer(name, { updateUrl: true, scroll: true });
  });
}

for (const button of $$(".segmented button")) {
  button.addEventListener("click", () => setAnimation(button.dataset.animation));
}

elements.autoRotateBtn.addEventListener("click", toggleAutoRotate);
elements.resetBtn.addEventListener("click", resetView);
elements.bgmToggle.addEventListener("click", toggleBgm);
elements.squashModeSwitch.addEventListener("click", (event) => {
  const button = event.target.closest("[data-mode]");
  if (!button || !elements.squashModeSwitch.contains(button)) return;
  setSquashMode(button.dataset.mode);
});
elements.autoSquashInterval.addEventListener("change", () => {
  const selected = Number(elements.autoSquashInterval.value);
  state.autoSquashInterval = Number.isFinite(selected)
    ? selected
    : AUTO_SQUASH_DEFAULT_INTERVAL;
  const interval = getAutoSquashInterval();
  state.autoSquashInterval = interval;
  elements.autoSquashInterval.value = String(interval);

  if (state.squashMode === "auto") {
    restartAutoSquash();
  }
  showToast(`自动间隔已设为 ${(interval / 1000).toFixed(1)} 秒`);
});
elements.uuidButton.addEventListener("click", copyUuid);
elements.copyUuidAction.addEventListener("click", copyUuid);

elements.clearHistoryBtn.addEventListener("click", () => {
  state.history = [];
  writeHistory();
  renderHistory();
  showToast("最近查看已清空");
});

elements.downloadBtn.addEventListener("click", () => {
  if (!state.profile) return;
  showToast("正在下载原始皮肤 PNG…");
});

elements.capeDownload.addEventListener("click", () => {
  if (!state.profile) return;
  showToast("正在下载披风 PNG…");
});

elements.textureImg.addEventListener("load", () => {
  const { naturalWidth, naturalHeight } = elements.textureImg;
  if (naturalWidth && naturalHeight) {
    elements.textureSize.textContent = `${naturalWidth} × ${naturalHeight}`;
  }
});

elements.textureImg.addEventListener("error", () => {
  elements.textureSize.textContent = "加载失败";
});

window.addEventListener("popstate", () => {
  const name = new URLSearchParams(window.location.search).get("u");
  if (name && USERNAME_PATTERN.test(name)) {
    loadPlayer(name, { updateUrl: false });
  }
});

/* ── Boot ─────────────────────────────────────────────── */

elements.bgmAudio.volume = 0.28;
elements.bgmAudio.addEventListener("error", () => {
  if (!state.bgmOn) return;
  setBgmUi(false);
  showToast("BGM 播放中断，请检查音频文件。", "error");
});

renderHistory();
createViewer();
new ResizeObserver(updatePlayerHeadCrop).observe(elements.playerHead);
elements.autoRotateBtn.classList.toggle("is-on", state.autoRotate);
elements.autoRotateBtn.setAttribute("aria-pressed", String(state.autoRotate));

const initialName = new URLSearchParams(window.location.search).get("u");
if (initialName && USERNAME_PATTERN.test(initialName)) {
  loadPlayer(initialName, { updateUrl: false });
} else {
  loadPlayer("Notch", { demo: true, updateUrl: false });
}
