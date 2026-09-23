import { Capacitor } from "@capacitor/core";
import { AdMob, AdmobConsentStatus, MaxAdContentRating } from "@capacitor-community/admob";
import { admobConfig, getRewardedAdUnitId, isAdmobTestMode } from "../config/admobConfig";

const PRIVACY_STATUS_EVENT = "chkoba:ad-privacy-status";
let initializationPromise: Promise<boolean> | null = null;
let privacyOptionsRequired = false;

function isNativeMobilePlatform(): boolean {
  const platform = Capacitor.getPlatform();
  return platform === "ios" || platform === "android";
}

function publishPrivacyStatus(required: boolean): void {
  privacyOptionsRequired = required;
  window.dispatchEvent(new CustomEvent(PRIVACY_STATUS_EVENT, { detail: { required } }));
}

export function isAdPrivacyOptionsRequired(): boolean {
  return privacyOptionsRequired;
}

export function subscribeToAdPrivacyStatus(listener: (required: boolean) => void): () => void {
  const handler = (event: Event) => {
    listener((event as CustomEvent<{ required: boolean }>).detail.required);
  };
  window.addEventListener(PRIVACY_STATUS_EVENT, handler);
  return () => window.removeEventListener(PRIVACY_STATUS_EVENT, handler);
}

export async function showAdPrivacyOptions(): Promise<void> {
  if (!isNativeMobilePlatform()) return;
  await AdMob.showPrivacyOptionsForm();
  initializationPromise = null;
  await initializeAdMob();
}

export function initializeAdMob(): Promise<boolean> {
  if (!isNativeMobilePlatform()) return Promise.resolve(false);
  if (initializationPromise) return initializationPromise;

  initializationPromise = (async () => {
    try {
      await AdMob.initialize({
        initializeForTesting: isAdmobTestMode,
        maxAdContentRating: MaxAdContentRating.General,
        tagForChildDirectedTreatment: false,
      });
      let consentInfo = await AdMob.requestConsentInfo();
      if (!consentInfo.canRequestAds && consentInfo.isConsentFormAvailable && consentInfo.status === AdmobConsentStatus.REQUIRED) {
        consentInfo = await AdMob.showConsentForm();
      }
      publishPrivacyStatus(consentInfo.privacyOptionsRequirementStatus === "REQUIRED");
      return consentInfo.canRequestAds;
    } catch (error) {
      console.error("[AdMob] initialization or consent failed", error);
      publishPrivacyStatus(false);
      return false;
    }
  })();
  return initializationPromise;
}

export async function showRewardedMatchEntryAd(): Promise<boolean> {
  const platform = Capacitor.getPlatform();
  if (platform !== "ios" && platform !== "android") return false;

  try {
    if (!(await initializeAdMob())) return false;
    const rewardedAdUnitId = getRewardedAdUnitId(platform);
    if (!rewardedAdUnitId) return false;
    await AdMob.prepareRewardVideoAd({ adId: rewardedAdUnitId, isTesting: isAdmobTestMode });
    const reward = await AdMob.showRewardVideoAd();
    return reward.amount > 0;
  } catch (error) {
    console.error("[AdMob] rewarded ad failed", error);
    return false;
  }
}

export const admobTestIds = {
  iosAppId: admobConfig.iosAppId,
  androidAppId: admobConfig.androidAppId,
  iosRewardedUnitId: admobConfig.iosRewardedIdTest,
  androidRewardedUnitId: admobConfig.androidRewardedIdTest,
};
