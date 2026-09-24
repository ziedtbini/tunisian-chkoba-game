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

type BannerAdProps = {
  className?: string;
};

function isNativePlatform(): boolean {
  const platform = Capacitor.getPlatform();
  return platform === "ios" || platform === "android";
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
    let retryTimer: number | null = null;
    let retryCount = 0;

    const platform = Capacitor.getPlatform();
    if (platform !== "ios" && platform !== "android") {
      return;
    }

    const bannerId = getBannerAdUnitId(platform);
    const position = BannerAdPosition.TOP_CENTER;
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
          bannerShowInFlight = false;
          return;
        }
        await AdMob.removeBanner().catch(() => {});
        bannerIsDisplayed = false;

        // Register listeners without blocking banner display flow.
        if (!loadedListener) void AdMob.addListener(BannerAdPluginEvents.Loaded, () => {
          bannerIsDisplayed = true;
          setIsBannerLoaded(true);
          console.log("[Banner] loaded");
        }).then((h) => {
          loadedListener = h;
        }).catch((error) => {
          console.log("[AdMob] banner listener(loaded) failed", error);
        });
        if (!failedListener) void AdMob.addListener(BannerAdPluginEvents.FailedToLoad, (error) => {
          setIsBannerLoaded(false);
          console.log("[Banner] failed to load", error);
          if (!cancelled && retryCount < 3 && retryTimer === null) {
            retryCount += 1;
            retryTimer = window.setTimeout(() => {
              retryTimer = null;
              bannerShowInFlight = false;
              void show(true);
            }, retryCount * 2500);
          }
        }).then((h) => {
          failedListener = h;
        }).catch((error) => {
          console.log("[AdMob] banner listener(failed) failed", error);
        });

        await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
        if (cancelled) return;

        const anchorTop = anchorRef.current?.getBoundingClientRect().top ?? 0;
        const margin = Math.max(0, Math.floor(anchorTop) - 56);
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
          position: useFallbackSize ? BannerAdPosition.BOTTOM_CENTER : position,
          margin: useFallbackSize ? 16 : margin,
        });
        console.log("[Banner] shown");
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
      bannerMountCount = Math.max(0, bannerMountCount - 1);
      void Promise.allSettled([
        loadedListener?.remove(),
        failedListener?.remove(),
      ]);
      setIsBannerLoaded(false);
      if (bannerMountCount === 0) {
        bannerDelayedRemoveTimer = window.setTimeout(() => {
          bannerDelayedRemoveTimer = null;
          void AdMob.removeBanner()
            .then(() => {
              bannerIsDisplayed = false;
              bannerShowInFlight = false;
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
        minHeight: isBannerLoaded ? 68 : 0,
        marginTop: isBannerLoaded ? 16 : 0,
        marginBottom: isBannerLoaded ? 16 : 0,
        overflow: "hidden",
      }}
      aria-hidden
    />
  );
}
