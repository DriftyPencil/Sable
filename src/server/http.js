import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

export function json(res, status = 200, payload = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload, null, 2));
}

export function text(res, status = 200, payload = "") {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(payload);
}

export async function serveStatic(req, res, context, pathname = "/") {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(context.publicDir, requested));

  if (!filePath.startsWith(context.publicDir)) {
    text(res, 403, "Forbidden");
    return;
  }

  try {
    const info = await stat(filePath);
    const ext = path.extname(filePath);

    if (!info.isFile()) throw new Error("Not a file");

    res.writeHead(200, {
      "Content-Type": context.mimeTypes[ext] || "application/octet-stream",
      "Cache-Control": "no-cache"
    });
    createReadStream(filePath).pipe(res);
  } catch {
    text(res, 404, "Not found");
  }
}
