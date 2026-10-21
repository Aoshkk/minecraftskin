import http from "node:http";
import path from "node:path";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, "dist");
const AUDIO_DIR = path.join(__dirname, "public", "audio");
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "127.0.0.1";
const DEV = process.argv.includes("--dev");
const USER_AGENT = "SkinLab/1.0 (Minecraft skin viewer; local app)";

const PROFILE_TTL = 5 * 60 * 1000;
const TEXTURE_TTL = 15 * 60 * 1000;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

const profileCache = new Map();
const textureCache = new Map();

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function getCached(map, key) {
  const entry = map.get(key);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > entry.ttl) {
    map.delete(key);
    return null;
  }
  return entry.value;
}

function setCached(map, key, value, ttl) {
  map.set(key, { value, createdAt: Date.now(), ttl });
  if (map.size > 250) {
    const oldestKey = map.keys().next().value;
    map.delete(oldestKey);
  }
}

function normalizeUsername(value) {
  const username = String(value || "").trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) {
    throw new HttpError(
      400,
      "INVALID_USERNAME",
      "请输入 3–16 位 Java 版正版 ID（仅限字母、数字和下划线）。",
    );
  }
  return username;
}

function formatUuid(raw) {
  return raw.replace(
    /^(.{8})(.{4})(.{4})(.{4})(.{12})$/,
    "$1-$2-$3-$4-$5",
  );
}

function safeDecodeBase64(value) {
  try {
    return Buffer.from(value, "base64").toString("utf8");
  } catch {
    return null;
  }
}

function parseTextures(properties) {
  const texturesProperty = properties?.find((item) => item.name === "textures");
  if (!texturesProperty?.value) return null;

  const decoded = safeDecodeBase64(texturesProperty.value);
  if (!decoded) return null;

  try {
    return JSON.parse(decoded)?.textures || null;
  } catch {
    return null;
  }
}

async function fetchWithTimeout(url, options = {}, timeout = 9000) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "User-Agent": USER_AGENT,
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(timeout),
  });
  return response;
}

async function resolveProfile(usernameInput) {
  const username = normalizeUsername(usernameInput);
  const cacheKey = username.toLowerCase();
  const cached = getCached(profileCache, cacheKey);
  if (cached) return cached;

  let basicResponse;
  try {
    basicResponse = await fetchWithTimeout(
      `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(username)}`,
      { headers: { Accept: "application/json" } },
    );
  } catch {
    throw new HttpError(
      502,
      "MOJANG_UNREACHABLE",
      "暂时无法连接 Mojang，请稍后再试。",
    );
  }

  if (basicResponse.status === 204 || basicResponse.status === 404) {
    throw new HttpError(
      404,
      "PLAYER_NOT_FOUND",
      `没有找到正版 ID「${username}」，请检查拼写。`,
    );
  }
  if (basicResponse.status === 429) {
    throw new HttpError(
      429,
      "RATE_LIMITED",
      "Mojang 查询有点频繁，请稍等片刻再试。",
    );
  }
  if (!basicResponse.ok) {
    throw new HttpError(
      502,
      "MOJANG_ERROR",
      `Mojang 返回了异常状态（${basicResponse.status}），请稍后再试。`,
    );
  }

  const basic = await basicResponse.json();
  if (!basic?.id || !basic?.name) {
    throw new HttpError(502, "MOJANG_ERROR", "Mojang 返回了无法识别的档案。");
  }

  let textures = null;
  try {
    const sessionResponse = await fetchWithTimeout(
      `https://sessionserver.mojang.com/session/minecraft/profile/${basic.id}`,
      { headers: { Accept: "application/json" } },
    );
    if (sessionResponse.ok) {
      const sessionProfile = await sessionResponse.json();
      textures = parseTextures(sessionProfile.properties);
    }
  } catch {
    // The skin proxy below still works when the session server is unavailable.
  }

  const officialSkinUrl = textures?.SKIN?.url
    ? textures.SKIN.url.replace(/^http:\/\//i, "https://")
    : null;
  const officialCapeUrl = textures?.CAPE?.url
    ? textures.CAPE.url.replace(/^http:\/\//i, "https://")
    : null;
  const fallbackSkinUrl = `https://mc-heads.net/skin/${encodeURIComponent(basic.name)}`;
  const model = textures?.SKIN?.metadata?.model === "slim" ? "slim" : "classic";

  const profile = {
    name: basic.name,
    rawUuid: basic.id,
    uuid: formatUuid(basic.id),
    skinUrl: `/api/skin/${encodeURIComponent(basic.name)}`,
    capeUrl: officialCapeUrl
      ? `/api/cape/${encodeURIComponent(basic.name)}`
      : null,
    textureUrl: officialSkinUrl || fallbackSkinUrl,
    capeTextureUrl: officialCapeUrl,
    model: officialSkinUrl ? model : null,
    hasCape: Boolean(officialCapeUrl),
    source: officialSkinUrl ? "mojang" : "community",
    fetchedAt: new Date().toISOString(),
  };

  setCached(profileCache, cacheKey, profile, PROFILE_TTL);
  return profile;
}

async function loadTexture(url) {
  const cached = getCached(textureCache, url);
  if (cached) return cached;

  let response;
  try {
    response = await fetchWithTimeout(url, {
      headers: { Accept: "image/png,image/*;q=0.9,*/*;q=0.1" },
    });
  } catch {
    throw new HttpError(502, "TEXTURE_UNREACHABLE", "皮肤纹理下载失败，请稍后再试。");
  }

  if (!response.ok) {
    throw new HttpError(
      502,
      "TEXTURE_ERROR",
      `皮肤纹理服务器返回了异常状态（${response.status}）。`,
    );
  }

  const contentType = response.headers.get("content-type") || "application/octet-stream";
  const buffer = Buffer.from(await response.arrayBuffer());
  const isPng =
    buffer.length > 8 &&
    buffer[0] === 0x89 &&
    buffer.subarray(1, 4).toString("ascii") === "PNG";

  if (!contentType.toLowerCase().startsWith("image/") && !isPng) {
    throw new HttpError(502, "TEXTURE_ERROR", "皮肤服务器返回的不是图片。");
  }

  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) {
    throw new HttpError(502, "TEXTURE_ERROR", "皮肤文件大小异常。");
  }

  const texture = {
    buffer,
    contentType: isPng ? "image/png" : contentType,
  };
  setCached(textureCache, url, texture, TEXTURE_TTL);
  return texture;
}

function sendJson(response, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  response.end(body);
}

function sendError(response, error) {
  const status = error instanceof HttpError ? error.status : 500;
  const code = error instanceof HttpError ? error.code : "INTERNAL_ERROR";
  const message =
    error instanceof HttpError
      ? error.message
      : "服务器开小差了，请稍后再试。";
  if (!(error instanceof HttpError)) {
    console.error("[server]", error);
  }
  sendJson(response, status, { ok: false, error: { code, message } });
}

function sendImage(response, texture, downloadName = null, method = "GET") {
  const headers = {
    "Content-Type": texture.contentType,
    "Content-Length": texture.buffer.length,
    "Cache-Control": "public, max-age=900",
    "X-Content-Type-Options": "nosniff",
  };
  if (downloadName) {
    headers["Content-Disposition"] =
      `attachment; filename="${downloadName}.png"; filename*=UTF-8''${encodeURIComponent(downloadName)}.png`;
  }
  response.writeHead(200, headers);
  response.end(method === "HEAD" ? undefined : texture.buffer);
}

async function handleProfileRoute(url, response) {
  const username = url.searchParams.get("username");
  const profile = await resolveProfile(username);
  sendJson(response, 200, { ok: true, profile });
}

async function handleTextureRoute(pathname, url, response, method) {
  const match = pathname.match(/^\/api\/(skin|cape)\/([^/]+)$/);
  if (!match) throw new HttpError(404, "NOT_FOUND", "接口不存在。");

  const [, kind, encodedName] = match;
  let name;
  try {
    name = decodeURIComponent(encodedName);
  } catch {
    throw new HttpError(400, "INVALID_USERNAME", "ID 格式无效。");
  }

  const profile = await resolveProfile(name);
  const textureUrl = kind === "skin" ? profile.textureUrl : profile.capeTextureUrl;
  if (!textureUrl) {
    throw new HttpError(404, "NO_CAPE", "这个玩家没有装备披风。");
  }

  const texture = await loadTexture(textureUrl);
  const downloadName =
    kind === "skin" ? `${profile.name}_skin` : `${profile.name}_cape`;
  const shouldDownload = url.searchParams.get("download") === "1";
  sendImage(response, texture, shouldDownload ? downloadName : null, method);
}

async function serveStatic(pathname, response, method) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    throw new HttpError(400, "BAD_REQUEST", "请求路径无效。");
  }

  let relativePath = decodedPath === "/" ? "/index.html" : decodedPath;
  let filePath = path.resolve(DIST_DIR, `.${relativePath}`);

  if (filePath !== DIST_DIR && !filePath.startsWith(`${DIST_DIR}${path.sep}`)) {
    throw new HttpError(403, "FORBIDDEN", "禁止访问。");
  }

  let fileStat;
  try {
    fileStat = await stat(filePath);
    if (fileStat.isDirectory()) {
      filePath = path.join(filePath, "index.html");
      fileStat = await stat(filePath);
    }
  } catch {
    if (!path.extname(relativePath)) {
      filePath = path.join(DIST_DIR, "index.html");
      try {
        fileStat = await stat(filePath);
      } catch {
        throw new HttpError(
          503,
          "NOT_BUILT",
          "网站尚未构建，请先运行 npm run build。",
        );
      }
    } else {
      throw new HttpError(404, "NOT_FOUND", "文件不存在。");
    }
  }

  if (!fileStat.isFile()) {
    throw new HttpError(404, "NOT_FOUND", "文件不存在。");
  }

  const body = await readFile(filePath);
  const extension = path.extname(filePath).toLowerCase();
  const isHashedAsset =
    relativePath.startsWith("/assets/") && /\.[a-f0-9]{8,}\./i.test(relativePath);

  response.writeHead(200, {
    "Content-Type": MIME_TYPES[extension] || "application/octet-stream",
    "Content-Length": body.length,
    "Cache-Control": isHashedAsset
      ? "public, max-age=31536000, immutable"
      : "no-cache",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "SAMEORIGIN",
  });
  response.end(method === "HEAD" ? undefined : body);
}

async function serveAudio(request, pathname, response, method) {
  let relativePath;
  try {
    relativePath = decodeURIComponent(pathname.slice("/audio/".length));
  } catch {
    throw new HttpError(400, "BAD_REQUEST", "音频路径无效。");
  }

  if (!relativePath) {
    throw new HttpError(404, "NOT_FOUND", "音频文件不存在。");
  }

  const filePath = path.resolve(AUDIO_DIR, relativePath);
  if (!filePath.startsWith(`${AUDIO_DIR}${path.sep}`)) {
    throw new HttpError(403, "FORBIDDEN", "禁止访问。");
  }

  const extension = path.extname(filePath).toLowerCase();
  if (![".mp3", ".ogg", ".wav", ".m4a"].includes(extension)) {
    throw new HttpError(404, "NOT_FOUND", "音频文件不存在。");
  }

  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch {
    throw new HttpError(
      404,
      "BGM_NOT_FOUND",
      "BGM 文件不存在，请将 friends-wine-dj.mp3 放入 public/audio/。",
    );
  }

  if (!fileStat.isFile()) {
    throw new HttpError(404, "NOT_FOUND", "音频文件不存在。");
  }

  const total = fileStat.size;
  let start = 0;
  let end = total - 1;
  let status = 200;
  const rangeHeader = request.headers.range;

  if (rangeHeader) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(String(rangeHeader).trim());
    if (!match || (match[1] === "" && match[2] === "")) {
      response.writeHead(416, {
        "Content-Range": `bytes */${total}`,
        "Content-Type": "text/plain; charset=utf-8",
      });
      response.end("Range Not Satisfiable");
      return;
    }

    if (match[1] === "") {
      const suffix = Number(match[2]);
      start = Math.max(0, total - suffix);
    } else {
      start = Number(match[1]);
      if (match[2] !== "") end = Math.min(Number(match[2]), total - 1);
    }

    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      start >= total ||
      start > end
    ) {
      response.writeHead(416, {
        "Content-Range": `bytes */${total}`,
        "Content-Type": "text/plain; charset=utf-8",
      });
      response.end("Range Not Satisfiable");
      return;
    }
    status = 206;
  }

  const headers = {
    "Content-Type": MIME_TYPES[extension] || "application/octet-stream",
    "Content-Length": end - start + 1,
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
  };
  if (status === 206) {
    headers["Content-Range"] = `bytes ${start}-${end}/${total}`;
  }

  response.writeHead(status, headers);
  if (method === "HEAD") {
    response.end();
    return;
  }

  const stream = createReadStream(filePath, { start, end });
  stream.on("error", () => response.destroy());
  stream.pipe(response);
}

const server = http.createServer(async (request, response) => {
  const method = request.method || "GET";
  if (method !== "GET" && method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD", "Content-Type": "text/plain" });
    response.end("Method Not Allowed");
    return;
  }

  let url;
  try {
    url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  } catch {
    sendError(response, new HttpError(400, "BAD_REQUEST", "请求无效。"));
    return;
  }

  try {
    if (url.pathname === "/api/health") {
      sendJson(response, 200, {
        ok: true,
        service: "skinlab",
        uptime: Math.round(process.uptime()),
      });
      return;
    }

    if (url.pathname === "/api/profile") {
      await handleProfileRoute(url, response);
      return;
    }

    if (url.pathname.startsWith("/api/skin/") || url.pathname.startsWith("/api/cape/")) {
      await handleTextureRoute(url.pathname, url, response, method);
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      throw new HttpError(404, "NOT_FOUND", "接口不存在。");
    }

    if (url.pathname.startsWith("/audio/")) {
      await serveAudio(request, url.pathname, response, method);
      return;
    }

    if (vite) {
      vite.middlewares(request, response, () => {
        sendError(response, new HttpError(404, "NOT_FOUND", "页面不存在。"));
      });
      return;
    }

    await serveStatic(url.pathname, response, method);
  } catch (error) {
    if (response.headersSent) {
      response.destroy();
      return;
    }
    sendError(response, error);
  }
});

let vite = null;
if (DEV) {
  try {
    const { createServer: createViteServer } = await import("vite");
    vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: { server },
      },
      appType: "spa",
    });
  } catch (error) {
    console.error("Failed to start the Vite dev server:", error);
    process.exit(1);
  }
}

server.listen(PORT, HOST, () => {
  console.log(`SkinLab running at http://${HOST}:${PORT} ${DEV ? "(dev)" : ""}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
