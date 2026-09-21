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

## Lokalni podatki in omejitve

WebView ima svoj storage profil, ločen od Chrome PWA. Od v5.4.7 se obstoječi
IndexedDB podatki prenesejo s polnim lokalnim backupom prek Android Share ali
sistemskega file chooserja. Uvoz je merge: dodatni Android zapisi ostanejo,
enaki ID-ji pa se posodobijo iz prenesenega backupa. Offline map tile cache se
ne prenaša in ga je treba v Android appu po potrebi ponovno prednaložiti.

## Prenos podatkov iz stare PWA

Od wrapper verzije 2 / AgroTracker v5.4.7 Activity sprejme Android `ACTION_SEND` za JSON backup. Prejeti backup se shrani lokalno, PWA ga bere po kosih prek `AgroNative.pendingImportSize()` in `readPendingImportChunk()`, nato ga po potrditvi mergea v IndexedDB. Alternativa je `Uvozi polni backup`, za kar WebView uporablja sistemski file chooser. Prenos ne uporablja strežnika.
