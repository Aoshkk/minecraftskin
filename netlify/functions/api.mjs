import vercelHandler from "../../api/[...path].js";

export const config = {
  path: "/api/*",
};

export default async function handler(request) {
  const url = new URL(request.url);
  const chunks = [];
  let statusCode = 200;
  const headers = {};

  const response = {
    headersSent: false,
    get statusCode() {
      return statusCode;
    },
    set statusCode(value) {
      statusCode = value;
    },
    setHeader(name, value) {
      headers[String(name).toLowerCase()] = String(value);
    },
    writeHead(code, nextHeaders = {}) {
      statusCode = code;
      for (const [name, value] of Object.entries(nextHeaders)) {
        headers[String(name).toLowerCase()] = String(value);
      }
    },
    end(chunk) {
      this.headersSent = true;
      if (chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
    },
  };

  const nodeRequest = {
    method: request.method,
    url: `${url.pathname}${url.search}`,
    headers: {
      ...Object.fromEntries(request.headers.entries()),
      host: url.host,
    },
  };

  try {
    await vercelHandler(nodeRequest, response);
  } catch (error) {
    console.error("[netlify-api]", error);
    return new Response(
      JSON.stringify({
        ok: false,
        error: { code: "INTERNAL_ERROR", message: "服务器开小差了，请稍后再试。" },
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      },
    );
  }

  const body = Buffer.concat(chunks);
  const responseHeaders = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    responseHeaders.set(name, value);
  }

  return new Response(body.length ? body : null, {
    status: statusCode,
    headers: responseHeaders,
  });
}
