import { useEffect, useRef, useState } from "react";
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { AdMob, BannerAdPluginEvents, BannerAdPosition, BannerAdSize } from "@capacitor-community/admob";
import { admobConfig, getBannerAdUnitId, isAdmobTestMode } from "../config/admobConfig";
import { initializeAdMob } from "../services/admobService";

let bannerRemoveInFlight = false;
let bannerShowInFlight = false;
let bannerIsDisplayed = false;
let bannerMountCount = 0;
let bannerDelayedRemoveTimer: number | null = null;
const BANNER_VISIBLE_CLASS = "ad-banner-visible";

type BannerAdProps = {
  className?: string;
};

function isNativePlatform(): boolean {
  const platform = Capacitor.getPlatform();
  return platform === "ios" || platform === "android";
}

function setBannerLayoutVisible(visible: boolean, height = 50): void {
  document.documentElement.classList.toggle(BANNER_VISIBLE_CLASS, visible);
  if (visible) {
    document.documentElement.style.setProperty("--ad-banner-height", `${Math.max(50, height)}px`);
  } else {
    document.documentElement.style.removeProperty("--ad-banner-height");
  }
}

export async function hideBannerAd(): Promise<void> {
  if (!isNativePlatform()) return;
  if (bannerRemoveInFlight) return;
  if (bannerDelayedRemoveTimer) {
    window.clearTimeout(bannerDelayedRemoveTimer);
    bannerDelayedRemoveTimer = null;
  }
  bannerRemoveInFlight = true;
  try {
    await AdMob.removeBanner().catch(() => {});
    bannerIsDisplayed = false;
    bannerShowInFlight = false;
    setBannerLayoutVisible(false);
    console.log("[Banner] hidden");
  } catch (error) {
    console.log("[Banner] hide failed", error);
  } finally {
    bannerRemoveInFlight = false;
  }
}

export default function BannerAd({ className }: BannerAdProps) {
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const [isBannerLoaded, setIsBannerLoaded] = useState(false);

  useEffect(() => {
    bannerMountCount += 1;
    if (bannerDelayedRemoveTimer) {
      window.clearTimeout(bannerDelayedRemoveTimer);
      bannerDelayedRemoveTimer = null;
    }
    let cancelled = false;
    let loadedListener: PluginListenerHandle | null = null;
    let failedListener: PluginListenerHandle | null = null;
    let sizeListener: PluginListenerHandle | null = null;
    let retryTimer: number | null = null;
    let loadWatchdog: number | null = null;
    let retryCount = 0;

    const platform = Capacitor.getPlatform();
    if (platform !== "ios" && platform !== "android") {
      return;
    }

    const bannerId = getBannerAdUnitId(platform);
    // The iOS plugin applies TOP_CENTER margins with a negative constraint,
    // which sends an inline banner off-screen. Anchor from the bottom instead.
    const position = BannerAdPosition.BOTTOM_CENTER;
    console.log(`[AdMob] banner mode: ${admobConfig.mode}`);
    console.log(`[AdMob] banner platform: ${platform}`);
    console.log(`[AdMob] banner id: ${bannerId}`);

    if (!bannerId) {
      console.log("[AdMob] banner failed: missing ad unit id");
      return;
    }

    const show = async (useFallbackSize = false) => {
      try {
        if (bannerShowInFlight || bannerIsDisplayed) {
          setIsBannerLoaded(bannerIsDisplayed);
          return;
        }
        bannerShowInFlight = true;
        if (!(await initializeAdMob())) {
          console.log("[Banner] blocked: AdMob initialization or consent did not allow requests");
          bannerShowInFlight = false;
          return;
        }
        await AdMob.removeBanner().catch(() => {});
        bannerIsDisplayed = false;

        // Register listeners without blocking banner display flow.
        if (!loadedListener) {
          loadedListener = await AdMob.addListener(BannerAdPluginEvents.Loaded, () => {
            if (loadWatchdog !== null) window.clearTimeout(loadWatchdog);
            loadWatchdog = null;
            bannerIsDisplayed = true;
            setIsBannerLoaded(true);
            setBannerLayoutVisible(true);
            console.log("[Banner] loaded");
          });
        }
        if (!failedListener) {
          failedListener = await AdMob.addListener(BannerAdPluginEvents.FailedToLoad, (error) => {
            if (loadWatchdog !== null) window.clearTimeout(loadWatchdog);
            loadWatchdog = null;
            setIsBannerLoaded(false);
            setBannerLayoutVisible(false);
            console.log("[Banner] failed to load", error);
            if (!cancelled && retryCount < 3 && retryTimer === null) {
              retryCount += 1;
              retryTimer = window.setTimeout(() => {
                retryTimer = null;
                bannerShowInFlight = false;
                void show(true);
              }, retryCount * 2500);
            }
          });
        }
        if (!sizeListener) {
          sizeListener = await AdMob.addListener(BannerAdPluginEvents.SizeChanged, (size) => {
            if (size.height > 0) setBannerLayoutVisible(true, size.height);
          });
        }

        await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
        if (cancelled) return;

        const anchorTop = anchorRef.current?.getBoundingClientRect().top ?? 0;
        const margin = 0;
        console.log(`[Banner] position used: ${position}`);
        console.log(`[Banner] margin used: ${margin}`);
        console.log("[AdMob] banner show request", {
          adId: bannerId,
          margin,
          position,
          adSize: BannerAdSize.ADAPTIVE_BANNER,
          anchorTop,
        });

        await AdMob.showBanner({
          adId: bannerId,
          isTesting: isAdmobTestMode,
          npa: true,
          adSize: useFallbackSize ? BannerAdSize.BANNER : BannerAdSize.ADAPTIVE_BANNER,
          position,
          margin,
        });
        console.log("[Banner] shown");
        loadWatchdog = window.setTimeout(() => {
          loadWatchdog = null;
          if (cancelled || bannerIsDisplayed || retryCount >= 3 || retryTimer !== null) return;
          retryCount += 1;
          console.log(`[Banner] load timeout, retry ${retryCount} with bottom fallback`);
          retryTimer = window.setTimeout(() => {
            retryTimer = null;
            bannerShowInFlight = false;
            void show(true);
          }, 500);
        }, 8000);
      } catch (error) {
        bannerIsDisplayed = false;
        console.log("[Banner] failed to show", error);
      } finally {
        bannerShowInFlight = false;
      }
    };

    void show();

    return () => {
      cancelled = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      if (loadWatchdog !== null) window.clearTimeout(loadWatchdog);
      bannerMountCount = Math.max(0, bannerMountCount - 1);
      void Promise.allSettled([
        loadedListener?.remove(),
        failedListener?.remove(),
        sizeListener?.remove(),
      ]);
      setIsBannerLoaded(false);
      setBannerLayoutVisible(false);
      if (bannerMountCount === 0) {
        bannerDelayedRemoveTimer = window.setTimeout(() => {
          bannerDelayedRemoveTimer = null;
          void AdMob.removeBanner()
            .then(() => {
              bannerIsDisplayed = false;
              bannerShowInFlight = false;
              setBannerLayoutVisible(false);
            })
            .catch((error) => {
              if (!cancelled) console.log("[AdMob] banner remove failed", error);
            });
        }, 500);
      }
    };
  }, []);

  return (
    <div
      ref={anchorRef}
      className={className}
      style={{
        position: "fixed",
        inset: "auto 0 0",
        height: isBannerLoaded ? "var(--ad-banner-height, 50px)" : 0,
        pointerEvents: "none",
        overflow: "hidden",
      }}
      aria-hidden
    />
  );
}
