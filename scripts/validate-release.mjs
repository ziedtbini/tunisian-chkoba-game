import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const envPath = path.join(root, ".env.production");
const plistPath = path.join(root, "ios/App/App/Info.plist");
const required = [
  "VITE_ADMOB_IOS_APP_ID",
  "VITE_ADMOB_IOS_BANNER_ID_PROD",
  "VITE_ADMOB_IOS_REWARDED_ID_PROD",
];

function parseEnv(contents) {
  return Object.fromEntries(
    contents.split(/\r?\n/).filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
      }),
  );
}

const errors = [];
if (!fs.existsSync(envPath)) errors.push("Missing .env.production");
if (!fs.existsSync(plistPath)) errors.push("Missing iOS Info.plist");

if (errors.length === 0) {
  const env = parseEnv(fs.readFileSync(envPath, "utf8"));
  if (!["prod", "production"].includes(env.VITE_ADMOB_MODE)) {
    errors.push("VITE_ADMOB_MODE must be prod or production");
  }
  for (const key of required) {
    if (!env[key]) errors.push(`${key} is missing`);
    if (env[key]?.includes("3940256099942544")) errors.push(`${key} still uses Google's test account`);
  }

  const plist = fs.readFileSync(plistPath, "utf8");
  if (env.VITE_ADMOB_IOS_APP_ID && !plist.includes(env.VITE_ADMOB_IOS_APP_ID)) {
    errors.push("Info.plist AdMob app ID does not match .env.production");
  }
}

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

console.log("Release configuration is consistent.");
