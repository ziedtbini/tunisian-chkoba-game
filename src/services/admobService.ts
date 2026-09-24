import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { AdMob, AdmobConsentStatus, MaxAdContentRating, RewardAdPluginEvents } from "@capacitor-community/admob";
import { admobConfig, getRewardedAdUnitId, isAdmobTestMode } from "../config/admobConfig";

const PRIVACY_STATUS_EVENT = "chkoba:ad-privacy-status";
let initializationPromise: Promise<boolean> | null = null;
let privacyOptionsRequired = false;
let consentStillRequired = false;
let rewardedLoadPromise: Promise<boolean> | null = null;
let rewardedReady = false;

export type RewardedAdResult = "rewarded" | "unavailable" | "consent-required" | "error";

function isNativeMobilePlatform(): boolean {
  const platform = Capacitor.getPlatform();
  return platform === "ios" || platform === "android";
}

function publishPrivacyStatus(required: boolean): void {
  privacyOptionsRequired = required;
  window.dispatchEvent(new CustomEvent(PRIVACY_STATUS_EVENT, { detail: { required } }));
}

async function requestIosTrackingAuthorization(): Promise<void> {
  if (Capacitor.getPlatform() !== "ios") return;

  const trackingInfo = await AdMob.trackingAuthorizationStatus();
  if (trackingInfo.status === "notDetermined") {
    await AdMob.requestTrackingAuthorization();
  }
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

  const attempt = (async () => {
    try {
      await AdMob.initialize({
        initializeForTesting: isAdmobTestMode,
        maxAdContentRating: MaxAdContentRating.General,
        tagForChildDirectedTreatment: false,
      });
      let consentInfo = await AdMob.requestConsentInfo();
      console.log("[AdMob] consent info", consentInfo);
      if (!consentInfo.canRequestAds && consentInfo.isConsentFormAvailable) {
        consentInfo = await AdMob.showConsentForm();
        console.log("[AdMob] consent form result", consentInfo);
      }
      consentStillRequired = !consentInfo.canRequestAds && consentInfo.status === AdmobConsentStatus.REQUIRED;
      publishPrivacyStatus(consentInfo.privacyOptionsRequirementStatus === "REQUIRED");
      if (consentInfo.canRequestAds) {
        try {
          await requestIosTrackingAuthorization();
        } catch (error) {
          // ATT refusal or restrictions must not block contextual ads.
          console.warn("[AdMob] tracking authorization unavailable", error);
        }
      }
      return consentInfo.canRequestAds;
    } catch (error) {
      console.error("[AdMob] initialization or consent failed", error);
      return false;
    }
  })();

  initializationPromise = attempt;
  void attempt.then((canRequestAds) => {
    // A temporary network/UMP failure must be retryable from the reward button.
    if (!canRequestAds && initializationPromise === attempt) initializationPromise = null;
  });
  return initializationPromise;
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, delayMs));
}

export function preloadRewardedMatchEntryAd(): Promise<boolean> {
  const platform = Capacitor.getPlatform();
  if (platform !== "ios" && platform !== "android") return Promise.resolve(false);
  if (rewardedReady) return Promise.resolve(true);
  if (rewardedLoadPromise) return rewardedLoadPromise;

  rewardedLoadPromise = (async () => {
    if (!(await initializeAdMob())) return false;
    const rewardedAdUnitId = getRewardedAdUnitId(platform);
    if (!rewardedAdUnitId) return false;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await AdMob.prepareRewardVideoAd({
          adId: rewardedAdUnitId,
          isTesting: isAdmobTestMode,
          npa: true,
        });
        rewardedReady = true;
        return true;
      } catch (error) {
        console.warn(`[AdMob] rewarded load attempt ${attempt} failed`, error);
        if (attempt < 3) await wait(attempt * 1500);
      }
    }
    return false;
  })().finally(() => {
    rewardedLoadPromise = null;
  });

  return rewardedLoadPromise;
}

async function presentRewardedAd(): Promise<RewardedAdResult> {
  const handles: PluginListenerHandle[] = [];

  return new Promise<RewardedAdResult>(async (resolve) => {
    let settled = false;
    const finish = (result: RewardedAdResult) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      void Promise.allSettled(handles.map((handle) => handle.remove()));
      resolve(result);
    };
    const timeoutId = window.setTimeout(() => finish("error"), 120_000);

    try {
      handles.push(await AdMob.addListener(RewardAdPluginEvents.Rewarded, () => finish("rewarded")));
      handles.push(await AdMob.addListener(RewardAdPluginEvents.Dismissed, () => finish("unavailable")));
      handles.push(await AdMob.addListener(RewardAdPluginEvents.FailedToShow, () => finish("error")));
      void AdMob.showRewardVideoAd()
        .then((reward) => finish(Number(reward.amount) > 0 ? "rewarded" : "unavailable"))
        .catch(() => finish("error"));
    } catch (error) {
      console.error("[AdMob] rewarded presentation failed", error);
      finish("error");
    }
  });
}

export async function showRewardedMatchEntryAd(): Promise<RewardedAdResult> {
  const platform = Capacitor.getPlatform();
  if (platform !== "ios" && platform !== "android") return "unavailable";

  try {
    if (!(await initializeAdMob())) return consentStillRequired ? "consent-required" : "error";
    if (!(await preloadRewardedMatchEntryAd())) return "unavailable";

    const result = await presentRewardedAd();
    rewardedReady = false;
    window.setTimeout(() => void preloadRewardedMatchEntryAd(), 1200);
    return result;
  } catch (error) {
    rewardedReady = false;
    console.error("[AdMob] rewarded ad failed", error);
    window.setTimeout(() => void preloadRewardedMatchEntryAd(), 2000);
    return "error";
  }
}

export const admobTestIds = {
  iosAppId: admobConfig.iosAppId,
  androidAppId: admobConfig.androidAppId,
  iosRewardedUnitId: admobConfig.iosRewardedIdTest,
  androidRewardedUnitId: admobConfig.androidRewardedIdTest,
};
