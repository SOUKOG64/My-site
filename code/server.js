const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, "data");
const DATA_FILE = path.join(DATA_DIR, "user-data.json");
const PORT = Number(process.env.PORT) || 5500;
const MAX_BODY_SIZE = 30 * 1024 * 1024;

const DEFAULT_DATA = {
  profile: {
    nickname: "",
    email: "",
    phone: ""
  },
  services: [],
  gallery: [],
  updatedAt: null
};

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8"
};

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(DEFAULT_DATA, null, 2), "utf8");
  }
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function sendText(response, statusCode, message) {
  response.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(message);
}

function sanitizeProfile(input) {
  if (!input || typeof input !== "object") {
    return { ...DEFAULT_DATA.profile };
  }

  return {
    nickname: typeof input.nickname === "string" ? input.nickname.trim().slice(0, 60) : "",
    email: typeof input.email === "string" ? input.email.trim().slice(0, 120) : "",
    phone: typeof input.phone === "string" ? input.phone.trim().slice(0, 40) : ""
  };
}

function sanitizeServices(input) {
  if (!Array.isArray(input)) {
    return [];
  }

  const unique = new Set();
  const clean = [];

  for (const item of input) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const url = typeof item.url === "string" ? item.url.trim() : "";
    if (!url) {
      continue;
    }

    let parsed;
    try {
      parsed = new URL(url);
    } catch (error) {
      continue;
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      continue;
    }

    const normalizedUrl = parsed.href;
    if (unique.has(normalizedUrl)) {
      continue;
    }

    unique.add(normalizedUrl);
    clean.push({
      id: typeof item.id === "string" ? item.id.slice(0, 80) : Date.now().toString(36) + "_" + Math.random().toString(36).slice(2),
      url: normalizedUrl,
      label: typeof item.label === "string" ? item.label.slice(0, 150) : normalizedUrl,
      createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString()
    });

    if (clean.length >= 100) {
      break;
    }
  }

  return clean;
}

function sanitizeGallery(input) {
  if (!Array.isArray(input)) {
    return [];
  }

  const clean = [];

  for (const item of input) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const src = typeof item.src === "string" ? item.src : "";
    if (!src.startsWith("data:image/")) {
      continue;
    }

    if (src.length > 8 * 1024 * 1024) {
      continue;
    }

    clean.push({
      id: typeof item.id === "string" ? item.id.slice(0, 80) : Date.now().toString(36) + "_" + Math.random().toString(36).slice(2),
      src,
      name: typeof item.name === "string" ? item.name.slice(0, 200) : "Без названия",
      createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString()
    });

    if (clean.length >= 50) {
      break;
    }
  }

  return clean;
}

function sanitizeUserData(input) {
  const obj = input && typeof input === "object" ? input : {};

  return {
    profile: sanitizeProfile(obj.profile),
    services: sanitizeServices(obj.services),
    gallery: sanitizeGallery(obj.gallery),
    updatedAt: typeof obj.updatedAt === "string" ? obj.updatedAt : null
  };
}

function readUserData() {
  ensureDataFile();

  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return sanitizeUserData(parsed);
  } catch (error) {
    return { ...DEFAULT_DATA };
  }
}

function writeUserData(nextData) {
  ensureDataFile();
  const payload = sanitizeUserData(nextData);
  payload.updatedAt = new Date().toISOString();
  fs.writeFileSync(DATA_FILE, JSON.stringify(payload, null, 2), "utf8");
  return payload;
}

function parseJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY_SIZE) {
        reject(new Error("payload too large"));
        request.destroy();
      }
    });

    request.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error("invalid json"));
      }
    });

    request.on("error", () => {
      reject(new Error("request error"));
    });
  });
}

async function handleApi(request, response, pathname) {
  if (pathname === "/api/health" && request.method === "GET") {
    sendJson(response, 200, { ok: true, time: new Date().toISOString() });
    return true;
  }

  if (pathname === "/api/user-data" && request.method === "GET") {
    sendJson(response, 200, readUserData());
    return true;
  }

  if (pathname === "/api/user-data/profile" && request.method === "PUT") {
    try {
      const body = await parseJsonBody(request);
      const current = readUserData();
      const next = {
        ...current,
        profile: sanitizeProfile(body)
      };
      sendJson(response, 200, writeUserData(next));
    } catch (error) {
      sendJson(response, 400, { error: "invalid_profile_payload" });
    }
    return true;
  }

  if (pathname === "/api/user-data/services" && request.method === "PUT") {
    try {
      const body = await parseJsonBody(request);
      const current = readUserData();
      const services = Array.isArray(body) ? body : body.services;
      const next = {
        ...current,
        services: sanitizeServices(services)
      };
      sendJson(response, 200, writeUserData(next));
    } catch (error) {
      sendJson(response, 400, { error: "invalid_services_payload" });
    }
    return true;
  }

  if (pathname === "/api/user-data/gallery" && request.method === "PUT") {
    try {
      const body = await parseJsonBody(request);
      const current = readUserData();
      const gallery = Array.isArray(body) ? body : body.gallery;
      const next = {
        ...current,
        gallery: sanitizeGallery(gallery)
      };
      sendJson(response, 200, writeUserData(next));
    } catch (error) {
      sendJson(response, 400, { error: "invalid_gallery_payload" });
    }
    return true;
  }

  return false;
}

function safePathFromUrl(pathname) {
  const decodedPath = decodeURIComponent(pathname);
  const normalized = path.normalize(decodedPath).replace(/^([.][.][/\\])+/, "");
  const relative = normalized.startsWith(path.sep) ? normalized.slice(1) : normalized;
  return path.join(ROOT_DIR, relative);
}

function serveStaticFile(request, response, pathname) {
  const targetPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = safePathFromUrl(targetPath);

  if (!filePath.startsWith(ROOT_DIR)) {
    sendText(response, 403, "Forbidden");
    return;
  }

  let stats;
  try {
    stats = fs.statSync(filePath);
  } catch (error) {
    sendText(response, 404, "Not Found");
    return;
  }

  if (stats.isDirectory()) {
    sendText(response, 403, "Forbidden");
    return;
  }

  const extension = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[extension] || "application/octet-stream";

  response.writeHead(200, { "Content-Type": contentType });
  fs.createReadStream(filePath).pipe(response);
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || "/", "http://localhost");
  const pathname = url.pathname;

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  try {
    const handledApi = await handleApi(request, response, pathname);
    if (handledApi) {
      return;
    }
    serveStaticFile(request, response, pathname);
  } catch (error) {
    sendJson(response, 500, { error: "internal_server_error" });
  }
});

ensureDataFile();
server.listen(PORT, () => {
  console.log(`FrameFlow server is running at http://localhost:${PORT}`);
});
