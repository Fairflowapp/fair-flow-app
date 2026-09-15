"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const { appRoot } = require("./env");
const ROOT = path.resolve(appRoot(), "public");
const PORT = Number(process.env.FF_QA_PORT || 4173);
const HOST = "127.0.0.1";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

function safeFile(urlPath) {
  const decoded = decodeURIComponent(String(urlPath || "/").split("?")[0]);
  const rel = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const abs = path.normalize(path.join(ROOT, rel));
  if (!abs.startsWith(ROOT)) return path.join(ROOT, "index.html");
  if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;
  return path.join(ROOT, "index.html");
}

const server = http.createServer((req, res) => {
  try {
    const file = safeFile(req.url);
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      "Content-Type": TYPES[ext] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    fs.createReadStream(file).pipe(res);
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("QA static server error\n");
    console.error(err);
  }
});

server.listen(PORT, HOST, () => {
  console.log("QA static server http://" + HOST + ":" + PORT + "/?env=staging");
});
