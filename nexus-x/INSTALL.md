# Installing NEXUS X

You install **two** apps, on two devices:

- **NEXUS X Controller** → the owner's phone (the one doing the monitoring).
- **NEXUS X Companion** → each device you want to manage, installed voluntarily
  by that device's user.

## Install the debug APKs

Enable "Install unknown apps" for your file manager or use ADB:

```bash
adb install -r controller/build/outputs/apk/debug/controller-debug.apk
adb install -r companion/build/outputs/apk/debug/companion-debug.apk
```

The two apps have different package ids (`com.nexusx.controller`,
`com.nexusx.companion`) and can coexist on the same device for testing.

## First run — Controller

1. Walk through onboarding and the permissions screen. Grant **Notifications**
   (for the discovery indicator). **Location** is optional and only used to show
   the Wi-Fi network name; discovery works without it.
2. The **Overview** and **Devices** screens begin scanning your current network.

## First run — Companion

1. Launch it; it starts a foreground service and waits.
2. When a Controller requests pairing, a card appears with a 6-digit verification
   code. Approve **only if that code matches the Controller's screen.**
3. While any screen share is active, a red banner and a notification stay visible,
   and a **Stop sharing now** button ends it immediately.

## Pairing two devices

Both devices must be on the **same Wi-Fi/LAN**. The Controller issues a QR +
short code; the Companion confirms; both verify the matching code. See
`STATUS.md` for exactly which parts of this flow are device-verified vs.
implemented-and-unit-tested.
