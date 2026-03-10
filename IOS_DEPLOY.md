# iOS Build & Deploy (Capacitor)

This project is prepared to ship as a native iOS app using Capacitor, while keeping the exact same React UI, game logic, and online gameplay.

## 1) Prerequisites (Mac)

- Xcode (latest stable)
- CocoaPods (`sudo gem install cocoapods` if missing)
- Node.js + npm
- Apple Developer account (for TestFlight / App Store)

## 2) Install Capacitor dependencies

```bash
npm run ios:install
```

## 3) Build web app and add iOS project

```bash
npm run build
npm run ios:add
```

## 4) Sync web build into iOS

```bash
npm run ios:sync
```

## 5) Open in Xcode

```bash
npm run ios:open
```

Then in Xcode:

1. Select target `App`
2. Set your Team in **Signing & Capabilities**
3. Verify bundle id (default: `com.chkoba.tn`)
4. Product -> Archive
5. Distribute via App Store Connect (TestFlight)

## 6) Rebuild cycle

After code changes:

```bash
npm run ios:sync
npm run ios:open
```

## Notes

- The iOS app uses the same UI/design as the web game.
- Online mode remains available (same PeerJS flow as web).
- Capacitor config is in `capacitor.config.ts`.

## 7) Mandatory/Optional Update Popup via Firebase Remote Config (Free)

The app now supports update control through Firebase Remote Config:
- optional update popup
- mandatory update lock (force update)

No custom domain is required.

### Required plugin

Install and sync once:

```bash
npm i @capacitor-firebase/remote-config@^7
npm run ios:sync
```

### Remote Config keys

Create these keys in Firebase Remote Config:

- `update_latest_version` (string, example: `1.0.3`)
- `update_min_supported_version` (string, example: `1.0.1`)
- `update_force_update` (boolean, `true` or `false`)
- `update_title` (string)
- `update_message` (string)
- `update_ios_store_url` (string, App Store URL)
- `update_android_store_url` (string, Play Store URL)

Rules:
- If current version < `update_min_supported_version` AND `update_force_update=true`: blocking popup.
- Else if current version < `update_latest_version`: optional popup ("Plus tard").

### iOS test

1. In Firebase Remote Config, set:
   - optional test: `update_force_update=false`, `update_latest_version` above your current app version.
   - forced test: `update_force_update=true`, `update_min_supported_version` above your current app version.
2. Publish changes in Remote Config.
3. Rebuild and run app:
```bash
npm run ios:sync
npm run ios:open
```
4. Validate on iPhone:
   - optional popup allows "Plus tard"
   - forced popup blocks app until store update.
