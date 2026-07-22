import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Native-shell config for the iOS and Android app-store builds.
 *
 * The web app is the source of truth; Capacitor wraps the built `dist/` in a
 * native WebView. Build for native with a *relative* base path so assets
 * resolve from the local filesystem rather than the GitHub Pages subpath:
 *
 *   BASE_PATH=./ npm run build && npx cap sync
 *
 * See CAPACITOR.md for the full store-build steps (they need a Mac with Xcode
 * and an Apple Developer account, which cannot be scripted here).
 */
const config: CapacitorConfig = {
  appId: 'com.davidbryansmith.solarforge',
  appName: 'SolarForge',
  webDir: 'dist',
  backgroundColor: '#0f172a',
  ios: {
    // The design canvas handles its own scrolling; the shell should not bounce.
    contentInset: 'never',
  },
}

export default config
