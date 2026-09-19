# AgroTracker Android wrapper

Namen: ohrani isti AgroTracker PWA UI, Android sloj pa doda samo tisto,
česar brskalniška PWA ne more zagotoviti: zanesljivo GPS sledenje v ozadju.

## Arhitektura

- `MainActivity` je tanek `WebView`, ki odpira produkcijski AgroTracker.
- `TrackingService` je Android foreground location service.
- Med vidnim UI se še naprej uporablja običajni PWA GPS.
- Ko Activity ni vidna, service zapisuje GPS točke v lokalni buffer.
- Ob vrnitvi PWA preko `AgroNative.drainLocations()` pobere točke in jih
  požene skozi isti `gps.injectFix()` / `Session.addFix()` tok.

## Dovoljenja

- `ACCESS_FINE_LOCATION` / `ACCESS_COARSE_LOCATION`
- `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_LOCATION`
- `WAKE_LOCK`
- `POST_NOTIFICATIONS`
- `INTERNET`

Za background GPS ne uporabljamo `ACCESS_BACKGROUND_LOCATION`: location
foreground service teče z vidnim ongoing obvestilom in se zažene, ko je
Activity v ospredju.

## Build

SDK je na `~/Android/Sdk`; release signing material je lokalno v
`~/.config/agrotracker/` in se NE commita.

Iz korena `android-wrapper/`:

```bash
export ANDROID_HOME="$HOME/Android/Sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
./gradlew clean assembleRelease
```

Končni APK:
`app/build/outputs/apk/release/app-release.apk`

Objavljena kopija:
`../downloads/AgroTracker-Android.apk`

## Omejitve

WebView ima svoj storage profil, ločen od Chrome PWA. UI/koda sta ista,
vendar obstoječi IndexedDB podatki iz Chrome PWA niso avtomatsko preneseni.
Do centralnega synca je za prehod potreben ponoven uvoz parcel/nastavitev
oziroma kasnejša namenska migracija.
