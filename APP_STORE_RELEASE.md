# App Store release checklist

## Automated checks

Run before every archive:

```bash
npm ci
npm run release:check
npm run ios:sync:prod
```

Then open `ios/App/App.xcworkspace`, select `Any iOS Device (arm64)` and use
`Product > Archive`.

## Required account configuration

- Create and publish GDPR/US-state messages in AdMob Privacy & messaging for the
  production AdMob application ID.
- Verify the production banner and rewarded units are active in AdMob.
- Publish all Remote Config update keys listed in `IOS_DEPLOY.md`, including the
  final App Store URL once Apple creates it.
- In App Store Connect, use the privacy-policy URL
  `https://ziedtbini.github.io/tunisian-chkoba-game/privacy-policy.html` and declare the data
  used by Google Mobile Ads, Firebase Analytics, Crashlytics and Remote Config.
- Add support URL, marketing text, description, category, age rating, copyright,
  screenshots for every supported device size and review notes explaining online
  rooms and rewarded ads.
- Confirm agreements, tax and banking details if monetized ads are enabled.

## Device acceptance test

- Fresh install: launch, onboarding, consent form and no crash.
- Refuse and accept ad consent in separate tests; confirm gameplay remains usable.
- Rewarded ad grants exactly one match only after the reward completes.
- Banner does not cover controls, including safe areas and landscape orientation.
- Complete local 1v1, online 1v1 and online 2v2 games through final scoring.
- Test online play once on Wi-Fi and once on cellular data.
- Verify airplane-mode behavior, background/foreground transitions and interrupted ads.
- Confirm optional and mandatory updates using Firebase Remote Config.
- Upload to TestFlight and review Crashlytics for regressions before submission.

## Publish the privacy policy with GitHub Pages

1. Push the `docs/privacy-policy.html` file to the default GitHub branch.
2. Open the repository `Settings > Pages`.
3. Under `Build and deployment`, select `Deploy from a branch`.
4. Select the default branch and the `/docs` folder, then save.
5. Verify that the URL above opens before adding it to AdMob or App Store Connect.
