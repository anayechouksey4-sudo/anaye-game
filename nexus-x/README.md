# NEXUS X

**Your Network. Your Control.**

A premium, consent-first Android suite for monitoring the devices on your *own*
local network and for secure, approved remote assistance between devices you
control. Built with Kotlin, Jetpack Compose (Material 3), MVVM, Coroutines/Flow,
Room, and the Android Keystore.

NEXUS X is **not** a surveillance tool. It performs ordinary network discovery
(the same thing `ping`, `arp` and any network scanner do), consent-based pairing
with mutual authentication, and remote assistance that always runs through
Android's own permission prompts. It never roots the device, never uses
accessibility services to bypass security, never captures credentials, and never
reaches into another app's private data.

---

## What is actually here

This repository contains a **complete, compiling native Android project** with
three Gradle modules:

| Module | What it is |
| --- | --- |
| `:core` | Shared engine: discovery, the 10-minute monitor, cryptography, the secure wire protocol, file-transfer logic, screen-capture wiring, Room persistence, and the data importers. |
| `:controller` | **NEXUS X Controller** — the owner's app. 12 screens: onboarding, permissions, network overview, live discovery, device detail, connection history, secure pairing, remote assistance, file transfer, privacy center, settings, diagnostics. |
| `:companion` | **NEXUS X Companion** — the lightweight, consent-first app for a managed device: pairing approval with a verification code, a live "sharing is active" banner, and an instant stop control. |

**Verified in this environment** (Linux cloud container, JDK 21, Gradle 8.11.1,
Android SDK 35, AGP 8.7.3):

- `:core` compiles and **48 unit tests pass** (cryptography, the handshake, the
  10-minute monitor, file-transfer integrity, the discovery reducer, parsers,
  and the wire protocol). See `core/src/test`.
- Debug APKs for both apps are built by Gradle. See `BUILD.md`.

**Requires a physical device or emulator to exercise** (the logic is implemented
and compiles, but live behaviour cannot be tested headlessly): on-device
discovery against a real LAN, MediaProjection screen capture, the two-device live
pairing handshake over sockets, and WebRTC-grade streaming. These limits and the
exact state of every module are spelled out in `STATUS.md`.

---

## Architecture

```
          ┌───────────────────────────┐        ┌───────────────────────────┐
          │     NEXUS X Controller     │        │     NEXUS X Companion      │
          │  (owner's phone)           │        │  (managed device)          │
          │  Compose UI · MVVM · Room  │        │  Compose UI · consent UI   │
          └─────────────┬─────────────┘        └─────────────┬─────────────┘
                        │                                     │
                        │   mutually-authenticated ECDH +     │
                        │   AES-256-GCM over LAN TCP          │
                        └──────────────┬──────────────────────┘
                                       │
                            ┌──────────┴───────────┐
                            │        :core         │
                            │ discovery · monitor  │
                            │ crypto · wire proto  │
                            │ transfer · screen    │
                            │ Room · importers     │
                            └──────────────────────┘
```

- **Pattern:** MVVM. ViewModels expose `StateFlow` UI state; repositories bridge
  the `:core` engines and Room; the UI is stateless Compose.
- **Security model:** each device holds a long-term EC P-256 identity key in the
  hardware-backed Android Keystore. Pairing performs ECDH, derives per-direction
  AES-256-GCM keys via HKDF, and shows a 6-digit short authentication string on
  both screens so a human rules out a machine-in-the-middle. Frames are sealed
  with sequence-numbered nonces, so replays and reordering fail to decrypt.

## The modules, mapped to the brief

1. **Network discovery** — `core/discovery`: ARP/neighbour cache, bounded ICMP/TCP
   ping sweep, and mDNS/NSD, folded by a pure reducer that tracks first/last-seen
   and an honest confidence level (`CONFIRMED` / `REACHABLE` / `INFERRED` /
   `STALE`). It never claims a hotspot client list the OS does not provide.
2. **10-minute monitor** — `core/monitor/ConnectionMonitor`: groups sightings into
   observation windows and highlights devices observed for 10 minutes or more. It
   is explicit that "observed" is not "provably connected the whole time".
3. **Device dashboard** — `:controller` overview + device detail: real counts,
   network info, and per-device history, with clear "unknown/unavailable" states
   instead of fabricated values.
4. **Secure pairing** — `core/pairing` + `core/crypto`: QR + short-code invite,
   ECDH mutual authentication, encrypted channel, session expiry, revocation, and
   on-device approval. No silent pairing.
5. **Remote assistance** — `core/screen` + the companion services: MediaProjection
   capture behind the system dialog, a persistent indicator, and instant stop.
6. **File management** — `core/transfer`: SAF-chosen files, chunked and SHA-256
   verified, with resume. No access to another device's private storage.
7. **Privacy & app data** — `core/privacy`: import your *own* WhatsApp/Instagram
   exports and search them locally. No E2E bypass, no scraping.
8. **Visual design** — AMOLED-black Compose theme with electric blue/cyan accents,
   glass cards, and a consistent component system.
9. **Security** — see `SECURITY.md`.
10–12. **Real implementation, tests, deliverables** — see `STATUS.md`, `BUILD.md`.

## Quick start

```bash
cd nexus-x
# run the verifiable unit tests
./gradlew :core:testDebugUnitTest
# build both debug APKs
./gradlew :controller:assembleDebug :companion:assembleDebug
```

See `BUILD.md`, `INSTALL.md`, and `TROUBLESHOOTING.md` for details, and
`STATUS.md` for the completed / partial / device-required checklist.
