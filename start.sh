#!/usr/bin/env bash
# Android RE Stack — boot emulator, start mitmproxy, launch Frida server
set -e

ANDROID_HOME="$HOME/android-sdk"
ANDROID_AVD_HOME="$HOME/.config/.android/avd"
export PATH="$PATH:$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools"
CERT_HASH="c8750f0d"
MITM_PORT=8080
MITM_WEB_PORT=8081
SESSION="$(date +%Y%m%d_%H%M%S)"
FLOWS_FILE="$HOME/android-re/captures/${SESSION}.flows"

mkdir -p "$HOME/android-re/captures" "$HOME/android-re/swagger"

echo "[1/5] Starting Android emulator (KVM accelerated)..."
"$ANDROID_HOME/emulator/emulator" \
  -avd android-re \
  -no-window -no-audio \
  -gpu swiftshader_indirect \
  -accel on \
  -writable-system \
  -port 5554 \
  -no-snapshot \
  > /tmp/emulator.log 2>&1 &

echo "    Waiting for boot..."
until [ "$(adb -s emulator-5554 shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do
  sleep 5
done
echo "    Booted."

echo "[2/5] Setting up system (root + overlayfs)..."
adb -s emulator-5554 root > /dev/null 2>&1
sleep 2
adb -s emulator-5554 remount > /dev/null 2>&1

echo "[3/5] Installing mitmproxy CA cert in system trust store..."
adb -s emulator-5554 push "$HOME/android-re/${CERT_HASH}.0" \
  "/system/etc/security/cacerts/${CERT_HASH}.0" > /dev/null
adb -s emulator-5554 shell chmod 644 "/system/etc/security/cacerts/${CERT_HASH}.0"

echo "[4/5] Configuring proxy → 10.0.2.2:${MITM_PORT}..."
adb -s emulator-5554 shell settings put global http_proxy "10.0.2.2:${MITM_PORT}"

echo "[5/5] Starting mitmweb (flows → ${FLOWS_FILE})..."
mitmweb -p "${MITM_PORT}" \
  --web-port "${MITM_WEB_PORT}" \
  --web-host 0.0.0.0 \
  -w "${FLOWS_FILE}" \
  > /tmp/mitmweb.log 2>&1 &

# Start frida-server on device
adb -s emulator-5554 shell \
  "pkill frida-server 2>/dev/null; nohup /data/local/tmp/frida-server > /dev/null 2>&1 &" \
  > /dev/null 2>&1

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  Android RE Stack Running                    ║"
echo "║  mitmweb UI  →  http://127.0.0.1:8081       ║"
echo "║  Flows file  →  captures/${SESSION}.flows   ║"
echo "║  ADB device  →  emulator-5554               ║"
echo "╠══════════════════════════════════════════════╣"
echo "║  Install APK:                                ║"
echo "║    adb -s emulator-5554 install app.apk     ║"
echo "║  SSL unpin + intercept:                      ║"
echo "║    objection -d emulator-5554 \              ║"
echo "║      -g com.pkg.name explore                 ║"
echo "║  Generate Swagger from capture:              ║"
echo "║    ~/android-re/to_swagger.sh               ║"
echo "╚══════════════════════════════════════════════╝"
