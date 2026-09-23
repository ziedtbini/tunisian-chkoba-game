import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const modeArg = process.argv[2];
const modeFromEnv = process.env.VITE_ADMOB_MODE;
const mode = modeArg || modeFromEnv || "production";
const envFile = path.join(root, `.env.${mode}`);
const manifestPath = path.join(root, "android", "app", "src", "main", "AndroidManifest.xml");

function parseEnvFile(filePath) {
  const map = {};
  if (!fs.existsSync(filePath)) return map;
  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, "");
    map[key] = value;
  }
  return map;
}

const envData = {
  ...parseEnvFile(envFile),
  ...process.env,
};

const appId = envData.VITE_ADMOB_ANDROID_APP_ID;
if (!appId) {
  console.error(
    `[admob-prepare] Missing VITE_ADMOB_ANDROID_APP_ID for mode "${mode}". ` +
      `Set it in ${path.basename(envFile)} or env vars.`
  );
  process.exit(1);
}

if (!fs.existsSync(manifestPath)) {
  console.warn(
    `[admob-prepare] AndroidManifest not found at ${manifestPath}. ` +
      `Run 'npx cap add android' first, then rerun this script.`
  );
  process.exit(0);
}

const manifest = fs.readFileSync(manifestPath, "utf8");
const metaRegex =
  /<meta-data\s+android:name="com\.google\.android\.gms\.ads\.APPLICATION_ID"\s+android:value="[^"]*"\s*\/>/m;

const metaTag = `<meta-data android:name="com.google.android.gms.ads.APPLICATION_ID" android:value="${appId}" />`;

let nextManifest;
if (metaRegex.test(manifest)) {
  nextManifest = manifest.replace(metaRegex, metaTag);
} else {
  nextManifest = manifest.replace(
    /<application([^>]*)>/m,
    `<application$1>\n        ${metaTag}`
  );
}

fs.writeFileSync(manifestPath, nextManifest, "utf8");
console.log(`[admob-prepare] mode=${mode} androidAppId=${appId}`);
