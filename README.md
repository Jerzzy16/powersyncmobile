# 🏋️ PowerSync (powersync-mobile-personal)

PowerSync is a mobile application for lifters that captures camera frames, streams them to a backend for pose estimation, and provides form analysis and feedback. This repository contains the mobile client built with React Native + Expo (with native modules), integrates Firebase, and uses several native libraries (e.g., TensorFlow Lite bindings, Vision Camera).

This project uses Expo with EAS for production builds. Note: because this app includes native modules it is not compatible with the standard Expo Go client; use a development client or build an APK/IPA.

---

## Tech stack

- React Native (0.79.x) + Expo (~53)
- Expo Router
- EAS (Expo Application Services) for builds
- Firebase (Auth, Firestore, Functions)
- Native modules: react-native-vision-camera, fast-tflite bindings, etc.
- TypeScript, Jest for tests, ESLint + Prettier for linting/formatting

---

## Quick links

- Project root: `README.md`
- Main scripts: defined in `package.json` (`start`, `android`, `ios`, `web`, `lint`, `test`)
- Firebase config: `firebaseConfig.js` and `google-services.json` / `GoogleService-Info.plist`

---

## Prerequisites

- Node.js (recommended >= 18.x)
- Yarn or npm
- Expo CLI and EAS CLI (optional globally; you can also use `npx`)
- Android Studio (for Android emulator or building via `expo run:android`) and Android SDK
- Xcode (required for building/running on iOS; macOS only)

Windows-specific notes: use PowerShell (this README shows PowerShell-friendly commands); building iOS requires macOS.

---

## Getting started (development)

1. Clone the repo and install dependencies:

```powershell
git clone <your-repo-url>
cd powersyncmobile
yarn install
# or: npm install
```

2. Configure Firebase / environment values

- Confirm `firebaseConfig.js` contains the correct Firebase project settings for your environment.
- For Android: place `google-services.json` in `android/app/` (already present in repo but double-check it matches your Firebase project).
- For iOS: place `GoogleService-Info.plist` in the iOS project (if you build iOS).

3. Start the Metro bundler / Expo server

```powershell
yarn start
# or: npm run start
```

4. Run on a device or emulator

- Android (emulator or connected device):

```powershell
yarn android
# or: npm run android/ npx expo run:android
```


Notes:
- Because this project includes native modules, the standard Expo Go client will not work. Use `expo run:android` / `expo run:ios` or create a custom dev client via `eas build -p android --profile development` and install it on your device.

---

## Production builds (EAS)

This repository includes `eas.json` for EAS builds. Example commands:

```powershell
# Android production build
eas build -p android --profile production

```

Follow Expo/EAS docs to configure credentials (keystore, Apple credentials) before building.

---

## Scripts (from `package.json`)

- `start` — Expo start server (Metro)
- `android` — expo run:android (installs and runs on device/emulator)
- `lint` — run ESLint
- `test` — run Jest tests

Example (PowerShell):

```powershell
yarn lint
yarn test
```

---

## Testing & linting

- Tests use Jest. Run `yarn test` or `npm run test` for the test suite.
- Lint with `yarn lint` (ESLint + Prettier configured).

---

## Important files & structure

Top-level files/folders to know:

- `app/` — Expo Router pages and app routes
- `src/` — source code (components, hooks, utils, contexts)
- `android/` — Android native project (for building/running native code)
- `assets/` — static assets, including ML models (see `src/app/assets/movenet_lightning.tflite`)
- `firebaseConfig.js` — project Firebase configuration wrapper
- `eas.json` — EAS build profiles
- `package.json` — scripts and dependencies

---

## Firebase setup notes

- Ensure the Firebase project has Authentication and Firestore enabled if you intend to use those features.
- Confirm `google-services.json` (Android) and `GoogleService-Info.plist` (iOS) are correct and placed in the native project as required.

---

## Troubleshooting

- App won't open / crashes:
  - Check native module installation and rebuild the app (`yarn android` / `yarn ios`).
  - Clear Metro cache: `expo start -c`.
- Permissions (camera/microphone): verify runtime permissions in Android settings and request permissions in-app.
- Backend connection problems: check signaling server URL and your device/network firewall.

If you still have problems, review logs from Metro and logcat (Android):

```powershell
# Show Android device logs
adb logcat | Select-String -Pattern "ReactNative" -SimpleMatch
```

---

## Contributing & next steps

- If you plan to contribute, open an issue or PR with a clear description and small, focused changes.
- Suggested improvements:
  - Add CI for tests and linting (GitHub Actions)
  - Add CONTRIBUTING.md and CODE_OF_CONDUCT.md
  - Document EAS credential setup and automated EAS builds

---

## License & maintainers

This repository is marked `private` in `package.json`. Add license information here if you change it to public.

Maintainers: repository owner / project team

---

If you'd like, I can also add a short `CONTRIBUTING.md`, example `.env.example`, or CI workflow to run tests and linting automatically.

