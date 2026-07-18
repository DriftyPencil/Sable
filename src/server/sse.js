export function sseHeaders(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  res.write(": connected\n\n");
}

export function writeSse(res, event = "", data = {}, id = "") {
  const payload = typeof data === "string" ? data : JSON.stringify(data);

  if (id) res.write(`id: ${id}\n`);
  if (event) res.write(`event: ${event}\n`);

  for (const line of payload.split(/\r?\n/)) {
    res.write(`data: ${line}\n`);
  }

  res.write("\n");
}

export function parseSseBlock(block = "") {
  const message = { data: "" };
  const lines = block.split(/\r?\n/);

  for (const rawLine of lines) {
    const separatorIndex = rawLine.indexOf(":");
    const field = separatorIndex === -1 ? rawLine : rawLine.slice(0, separatorIndex);
    const value = separatorIndex === -1
      ? ""
      : rawLine.slice(separatorIndex + 1).replace(/^ /, "");

    if (!rawLine || rawLine.startsWith(":")) continue;
    if (field === "data") message.data += `${value}\n`;
    if (field === "event") message.event = value;
    if (field === "id") message.id = value;
    if (field === "retry") message.retry = Number(value);
  }

  message.data = message.data.replace(/\n$/, "");
  return message.data || message.event || message.id ? message : null;
}

export function parseSseData(data = "") {
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
}
