# Building NEXUS X

## Toolchain (verified)

| Tool | Version used |
| --- | --- |
| JDK | 21 (also works on 17) |
| Gradle | 8.11.1 (via the wrapper) |
| Android Gradle Plugin | 8.7.3 |
| Kotlin | 2.0.21 |
| compileSdk / targetSdk | 35 |
| minSdk | 26 (Android 8.0) |
| Build tools | 35.0.0 |

The target device, the **Samsung Galaxy M06 5G**, runs Android 15 (API 35), well
within this range.

## Point Gradle at your Android SDK

Create `nexus-x/local.properties` (not committed) with your SDK path:

```properties
sdk.dir=/absolute/path/to/Android/sdk
```

Or export `ANDROID_HOME` / `ANDROID_SDK_ROOT`. You need the platform
`android-35` and build-tools `35.0.0` installed (via Android Studio's SDK
Manager, or `sdkmanager "platforms;android-35" "build-tools;35.0.0" "platform-tools"`).

## Build

```bash
cd nexus-x

# Run the core unit tests (43 tests — crypto, handshake, monitor, transfer, parsers, protocol)
./gradlew :core:testDebugUnitTest

# Build both debug APKs
./gradlew :controller:assembleDebug :companion:assembleDebug
```

Outputs:

```
controller/build/outputs/apk/debug/controller-debug.apk
companion/build/outputs/apk/debug/companion-debug.apk
```

Debug APKs are automatically signed with Android's debug keystore, so they
install directly for testing.

## Release builds

`release` build types are configured (unsigned by default). To ship, add a
signing config in each app's `build.gradle.kts` and run
`./gradlew :controller:assembleRelease :companion:assembleRelease`.

## Note on the Maven mirror

`settings.gradle.kts` lists Google's Cloud Storage mirror of Maven Central first
(`maven-central.storage-download.googleapis.com`). This is only to avoid rate
limits on shared CI IPs; `mavenCentral()` is still listed as a fallback and you
can remove the mirror line if you prefer the canonical repository.
