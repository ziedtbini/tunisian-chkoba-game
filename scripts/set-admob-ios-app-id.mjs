import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const modeArg = process.argv[2];
const modeFromEnv = process.env.VITE_ADMOB_MODE;
const mode = modeArg || modeFromEnv || "production";
const envFile = path.join(root, `.env.${mode}`);
const infoPlistPath = path.join(root, "ios", "App", "App", "Info.plist");

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

const appId = envData.VITE_ADMOB_IOS_APP_ID;
if (!appId) {
  console.error(
    `[admob-prepare] Missing VITE_ADMOB_IOS_APP_ID for mode "${mode}". ` +
      `Set it in ${path.basename(envFile)} or env vars.`
  );
  process.exit(1);
}

if (!fs.existsSync(infoPlistPath)) {
  console.error(`[admob-prepare] Info.plist not found at ${infoPlistPath}`);
  process.exit(1);
}

const plist = fs.readFileSync(infoPlistPath, "utf8");
const keyRegex =
  /<key>GADApplicationIdentifier<\/key>\s*<string>[\s\S]*?<\/string>/m;

let nextPlist;
if (keyRegex.test(plist)) {
  nextPlist = plist.replace(
    keyRegex,
    `<key>GADApplicationIdentifier</key>\n\t<string>${appId}</string>`
  );
} else {
  nextPlist = plist.replace(
    /<\/dict>/m,
    `\t<key>GADApplicationIdentifier</key>\n\t<string>${appId}</string>\n</dict>`
  );
}

fs.writeFileSync(infoPlistPath, nextPlist, "utf8");
console.log(`[admob-prepare] mode=${mode} appId=${appId}`);
