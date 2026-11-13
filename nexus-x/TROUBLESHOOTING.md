# Troubleshooting

### `SDK location not found`
Create `nexus-x/local.properties` with `sdk.dir=/path/to/Android/sdk`, or set
`ANDROID_HOME`. Install `platforms;android-35` and `build-tools;35.0.0`.

### `Received status code 429 ... Too Many Requests` during dependency download
A shared IP was rate-limited by Maven Central. `settings.gradle.kts` already puts
Google's Cloud Storage mirror first to avoid this. Re-run the build; Gradle caches
what already downloaded. If it persists, wait a minute and retry.

### `Cannot access 'androidx.room.RoomDatabase' ...`
Only relevant if you change `:core` dependencies: Room and coroutines are exposed
with `api(...)` in `core/build.gradle.kts` because `:core` surfaces their types in
its public API. Keep them as `api`, not `implementation`.

### No devices appear on the dashboard
- Confirm Wi-Fi is connected (cellular-only has no LAN to scan).
- Some networks enable **client isolation** (common on guest/hotspot Wi-Fi),
  which blocks device-to-device probes — this is a network setting, not a bug.
- A **VPN** scopes discovery to the VPN interface. Diagnostics shows this.
- `/proc/net/arp` is restricted on newer Android, so MAC/vendor may be blank;
  discovery falls back to the active sweep.

### Pairing never completes
Both devices must be on the same subnet with client isolation off. The Companion
must show the request card; approve it there. Verify the 6-digit codes match.

### Screen share shows nothing / is black
Some apps (banking, DRM video) mark their windows `FLAG_SECURE`; Android blanks
them in any capture. This is expected and cannot be bypassed.

### Build is slow the first time
The first run downloads the Gradle distribution and all Android/Compose
dependencies. Subsequent builds are incremental and fast.
