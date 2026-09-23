export const isAdmobTestMode = import.meta.env.VITE_ADMOB_MODE === "test";

const TEST_DEFAULTS = {
  iosAppId: "ca-app-pub-3940256099942544~1458002511",
  androidAppId: "ca-app-pub-3940256099942544~3347511713",
  iosBannerId: "ca-app-pub-3940256099942544/2435281174",
  androidBannerId: "ca-app-pub-3940256099942544/9214589741",
  iosRewardedId: "ca-app-pub-3940256099942544/1712485313",
  androidRewardedId: "ca-app-pub-3940256099942544/5224354917",
};

export const admobConfig = {
  mode: isAdmobTestMode ? "test" : "prod",
  iosAppId: import.meta.env.VITE_ADMOB_IOS_APP_ID || TEST_DEFAULTS.iosAppId,
  androidAppId: import.meta.env.VITE_ADMOB_ANDROID_APP_ID || TEST_DEFAULTS.androidAppId,
  iosBannerIdTest:
    import.meta.env.VITE_ADMOB_IOS_BANNER_ID_TEST || TEST_DEFAULTS.iosBannerId,
  androidBannerIdTest:
    import.meta.env.VITE_ADMOB_ANDROID_BANNER_ID_TEST || TEST_DEFAULTS.androidBannerId,
  iosBannerIdProd: import.meta.env.VITE_ADMOB_IOS_BANNER_ID_PROD || "",
  androidBannerIdProd: import.meta.env.VITE_ADMOB_ANDROID_BANNER_ID_PROD || "",
  iosRewardedIdTest:
    import.meta.env.VITE_ADMOB_IOS_REWARDED_ID_TEST || TEST_DEFAULTS.iosRewardedId,
  androidRewardedIdTest:
    import.meta.env.VITE_ADMOB_ANDROID_REWARDED_ID_TEST || TEST_DEFAULTS.androidRewardedId,
  iosRewardedIdProd: import.meta.env.VITE_ADMOB_IOS_REWARDED_ID_PROD || "",
  androidRewardedIdProd: import.meta.env.VITE_ADMOB_ANDROID_REWARDED_ID_PROD || "",
} as const;

export function getRewardedAdUnitId(platform: "ios" | "android"): string {
  if (isAdmobTestMode) {
    return platform === "ios" ? admobConfig.iosRewardedIdTest : admobConfig.androidRewardedIdTest;
  }
  return platform === "ios" ? admobConfig.iosRewardedIdProd : admobConfig.androidRewardedIdProd;
}

export function getBannerAdUnitId(platform: "ios" | "android"): string {
  if (isAdmobTestMode) {
    return platform === "ios" ? admobConfig.iosBannerIdTest : admobConfig.androidBannerIdTest;
  }
  return platform === "ios" ? admobConfig.iosBannerIdProd : admobConfig.androidBannerIdProd;
}
