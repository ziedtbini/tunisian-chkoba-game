import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.chkoba.tn",
  appName: "Chkobba Online",
  webDir: "dist",
  bundledWebRuntime: false,
  ios: {
    contentInset: "never",
    allowsLinkPreview: false,
    scrollEnabled: true,
  },
};

export default config;
