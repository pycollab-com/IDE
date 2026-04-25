import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(__dirname, "..");
const sourceDir = path.join(clientRoot, "node_modules", "pyodide");
const targetDir = path.join(clientRoot, "public", "vendor", "pyodide", "v0.29.3", "full");

function copyDir(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      copyDir(sourcePath, targetPath);
      continue;
    }
    const payload = fs.readFileSync(sourcePath);
    fs.writeFileSync(targetPath, payload);
  }
}

if (!fs.existsSync(sourceDir)) {
  console.error("Missing `pyodide` package. Run `npm install` in `client/` before building.");
  process.exit(1);
}

fs.mkdirSync(path.dirname(targetDir), { recursive: true });
fs.rmSync(targetDir, { recursive: true, force: true });
copyDir(sourceDir, targetDir);
console.log(`Synced Pyodide assets to ${targetDir}`);
