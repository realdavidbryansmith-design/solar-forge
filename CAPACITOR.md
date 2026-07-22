# App-store builds (iOS and Android)

The web app is the source of truth. Capacitor wraps the built `dist/` in a
native WebView so it can be listed on the App Store and Google Play. The web
features work unchanged inside the shell — including the camera, because the
photo importer uses a standard file input with `capture="environment"`.

**What is set up:** `capacitor.config.ts`, the Capacitor dependencies, and the
build scripts. **What is not:** the native `ios/` and `android/` project folders.
Those are generated on your machine and need Xcode / Android Studio to build, so
they cannot be produced or verified here. The steps below do that.

Everything from here needs **a Mac with Xcode** (for iOS) and, for Android,
**Android Studio + a JDK**. None of it can be scripted from this environment.

---

## First-time setup

```bash
# From the project root
npx cap add ios
npx cap add android
```

This creates `ios/` and `android/` (both gitignored — they are generated
artifacts, not source).

## Build and open

```bash
npm run cap:sync          # builds with a relative base path, copies into the shells
npx cap open ios          # opens Xcode
npx cap open android      # opens Android Studio
```

`cap:sync` runs `BASE_PATH=./ npm run build` first — the native shell loads
assets from the local filesystem, so it needs relative paths, not the
`/solar-forge/` Pages prefix. Do not commit a `dist/` built this way; the deploy
script rebuilds for Pages.

## iOS store submission

1. In Xcode, set the signing team (your Apple Developer account, $99/yr) and a
   bundle identifier matching `capacitor.config.ts` (`com.davidbryansmith.solarforge`).
2. Add the icon set (see `public/icon-512.png` for the source artwork).
3. Product → Archive → Distribute App → App Store Connect.
4. Fill in the App Store Connect listing, screenshots, and privacy details.

**Privacy — this app must declare it correctly or it will be rejected:**
- It reads photo EXIF and can use the camera. Add `NSCameraUsageDescription`
  and `NSPhotoLibraryUsageDescription` to `Info.plist` with honest strings,
  e.g. *"To import an aerial photo of your property for tracing."*
- It reads location *from photos*, not from the device GPS. Do not request
  location permission — you do not use it, and requesting it invites rejection.

**Apple review risk — read before submitting.** Apple scrutinises apps that give
technical or professional guidance. This app computes NEC electrical figures. Two
things reduce the risk, and both are already true in the product:
- The unverified-tables banner and the licensed-electrician requirement are
  prominent and unavoidable on the Code tab.
- The app is a design aid, not a certification or permit tool, and says so.

Do not describe it in the store listing as producing code-compliant or
permit-ready output. Describe it as a design and estimation aid. Getting the
NEC tables checked by a licensed electrician (see VERIFICATION.md) before a
public store listing is the single biggest thing that lowers your exposure.

## Android store submission

Google's review is far more lenient and faster than Apple's — a reasonable place
to go live first.

1. In Android Studio, set the application ID to match the bundle identifier.
2. Build → Generate Signed Bundle / APK → Android App Bundle.
3. Upload the `.aab` to the Play Console ($25 one-time), complete the data-safety
   form (declare camera and that photo metadata is read locally and not
   transmitted), and submit.

---

## Meanwhile: the app already installs without a store

On both iOS and Android, the live PWA installs to the home screen via the
browser's "Add to Home Screen". No store, no fee, no review, no public-listing
liability exposure. That is the recommended distribution until the NEC tables
are professionally verified — the native shells above are the path for when you
decide to list publicly.
