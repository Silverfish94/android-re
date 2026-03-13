# android-re

Android API reverse engineering environment on Kali Linux.

## Stack

- **Android 13 AVD** — KVM-accelerated via Android SDK emulator
- **mitmproxy** — HTTPS interception with system-level CA trust
- **Frida 17** — dynamic instrumentation / SSL unpinning
- **objection** — automated SSL pin bypass
- **mitmproxy2swagger** — convert captured traffic to OpenAPI 3.0 spec

## Requirements

- Kali Linux (or Debian-based) host
- KVM enabled (`/dev/kvm` must exist)
- Android SDK installed at `~/android-sdk`
- Java 17+

```bash
sudo modprobe kvm_amd   # or kvm_intel
```

## Quick Start

```bash
./start.sh
```

This will:
1. Boot Android 13 AVD with KVM acceleration
2. Root device + enable overlayfs
3. Install mitmproxy CA cert in system trust store
4. Set device proxy → mitmproxy
5. Start mitmweb UI at http://127.0.0.1:8081
6. Start frida-server on device

## Snapchat / Snapmap Bypass

Snapchat requires several bypasses to intercept traffic:

### 1. Get a compatible APK

Download an older Snapchat version (12.x–13.x recommended) from APKMirror.
Newer versions have stronger emulator/root detection.

### 2. Patch the APK (remove network security config pinning)

```bash
./patch_apk.sh snapchat.apk
```

This uses apktool to remove `network_security_config` cert pinning and re-signs the APK.

### 3. Bypass root/emulator detection at runtime

```bash
# After installing the patched APK:
objection -d emulator-5554 -g com.snapchat.android explore
# inside objection:
android root disable
android sslpinning disable
```

Or use the Frida script directly:

```bash
frida -D emulator-5554 -l frida/snapchat_bypass.js -f com.snapchat.android
```

### 4. Generate Swagger from captured Snapmap traffic

```bash
./to_swagger.sh captures/snapchat_*.flows https://ms.sc-cdn.net
./to_swagger.sh captures/snapchat_*.flows https://aws.api.snapchat.com
```

## File Structure

```
android-re/
├── start.sh              # Boot full stack
├── patch_apk.sh          # Remove SSL pinning from APK
├── to_swagger.sh         # Convert captures → OpenAPI spec
├── frida/
│   └── snapchat_bypass.js  # Frida script: root + SSL + emulator bypass
├── captures/             # .flows files (gitignored)
└── swagger/              # Generated OpenAPI specs (gitignored)
```
