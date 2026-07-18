import { readFile } from "node:fs/promises";

export async function loadLocalEnv(filePath = "") {
  try {
    const contents = await readFile(filePath, "utf8");
    const lines = contents.split(/\r?\n/);

    for (const rawLine of lines) {
      const line = rawLine.trim();
      const separator = line.indexOf("=");
      let value = "";
      const key = separator === -1 ? "" : line.slice(0, separator).trim();

      if (!line || line.startsWith("#") || separator === -1 || !key) continue;

      value = line.slice(separator + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}
