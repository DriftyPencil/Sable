import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const roots = ["src/server", "public"];
const checkedFiles = [];

function collectJavaScriptFiles(dir = "") {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectJavaScriptFiles(path));
      continue;
    }

    if (entry.isFile() && path.endsWith(".js")) {
      files.push(path);
    }
  }

  return files;
}

for (const root of roots) {
  if (statSync(root).isDirectory()) {
    checkedFiles.push(...collectJavaScriptFiles(root));
  }
}

for (const file of checkedFiles) {
  const result = spawnSync(process.execPath, ["--check", file], {
    encoding: "utf8",
    stdio: "pipe"
  });

  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status || 1);
  }
}

process.stdout.write(`Checked ${checkedFiles.length} JavaScript files.\n`);
