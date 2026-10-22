const USER_AGENT = "SkinLab/1.0 (Minecraft skin viewer; Vercel)";
const PROFILE_TTL = 5 * 60 * 1000;
const TEXTURE_TTL = 15 * 60 * 1000;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

const profileCache = new Map();
const textureCache = new Map();

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
    map.delete(map.keys().next().value);
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

function parseTextures(properties) {
  const item = properties?.find((entry) => entry.name === "textures");
  if (!item?.value) return null;
  try {
    return JSON.parse(Buffer.from(item.value, "base64").toString("utf8"))?.textures || null;
  } catch {
    return null;
  }
}

async function fetchWithTimeout(url, options = {}, timeout = 9000) {
  return fetch(url, {
    ...options,
    headers: {
      "User-Agent": USER_AGENT,
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(timeout),
  });
}

async function resolveProfile(input) {
  const username = normalizeUsername(input);
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
    throw new HttpError(502, "MOJANG_UNREACHABLE", "暂时无法连接 Mojang，请稍后再试。");
  }

  if (basicResponse.status === 204 || basicResponse.status === 404) {
    throw new HttpError(
      404,
      "PLAYER_NOT_FOUND",
      `没有找到正版 ID「${username}」，请检查拼写。`,
    );
  }
  if (basicResponse.status === 429) {
    throw new HttpError(429, "RATE_LIMITED", "Mojang 查询有点频繁，请稍等片刻再试。");
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
    // Fall through to the community skin endpoint.
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
    capeUrl: officialCapeUrl ? `/api/cape/${encodeURIComponent(basic.name)}` : null,
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
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(body));
  response.setHeader("Cache-Control", "no-store");
  for (const [key, value] of Object.entries(extraHeaders)) {
    response.setHeader(key, value);
  }
  response.end(body);
}

function sendError(response, error) {
  const status = error instanceof HttpError ? error.status : 500;
  const code = error instanceof HttpError ? error.code : "INTERNAL_ERROR";
  const message =
    error instanceof HttpError ? error.message : "服务器开小差了，请稍后再试。";
  if (!(error instanceof HttpError)) console.error("[vercel-api]", error);
  sendJson(response, status, { ok: false, error: { code, message } });
}

function sendImage(response, texture, downloadName, method) {
  response.statusCode = 200;
  response.setHeader("Content-Type", texture.contentType);
  response.setHeader("Content-Length", texture.buffer.length);
  response.setHeader("Cache-Control", "public, max-age=900");
  response.setHeader("X-Content-Type-Options", "nosniff");
  if (downloadName) {
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="${downloadName}.png"; filename*=UTF-8''${encodeURIComponent(downloadName)}.png`,
    );
  }
  response.end(method === "HEAD" ? undefined : texture.buffer);
}

export default async function handler(request, response) {
  const method = request.method || "GET";
  if (method !== "GET" && method !== "HEAD") {
    response.statusCode = 405;
    response.setHeader("Allow", "GET, HEAD");
    response.end("Method Not Allowed");
    return;
  }

  let url;
  try {
    url = new URL(request.url || "/", `https://${request.headers.host || "localhost"}`);
  } catch {
    sendError(response, new HttpError(400, "BAD_REQUEST", "请求无效。"));
    return;
  }

  try {
    if (url.pathname === "/api/health") {
      sendJson(response, 200, { ok: true, service: "skinlab" });
      return;
    }

    if (url.pathname === "/api/profile") {
      const profile = await resolveProfile(url.searchParams.get("username"));
      sendJson(response, 200, { ok: true, profile });
      return;
    }

    const match = url.pathname.match(/^\/api\/(skin|cape)\/([^/]+)$/);
    if (match) {
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
      sendImage(
        response,
        texture,
        shouldDownload ? downloadName : null,
        method,
      );
      return;
    }

    throw new HttpError(404, "NOT_FOUND", "接口不存在。");
  } catch (error) {
    if (response.headersSent) {
      response.end();
      return;
    }
    sendError(response, error);
  }
}
