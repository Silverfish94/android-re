#!/usr/bin/env bash
# Android RE Stack — boot emulator, start mitmproxy, launch Frida server, open scrcpy UI
set -e

ANDROID_HOME="$HOME/android-sdk"
ANDROID_AVD_HOME="$HOME/.config/.android/avd"
export PATH="$PATH:$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools"
CERT_HASH="c8750f0d"
MITM_PORT=8080
MITM_WEB_PORT=8081
SESSION="$(date +%Y%m%d_%H%M%S)"
FLOWS_FILE="$HOME/android-re/captures/${SESSION}.flows"
XVFB_DISPLAY=":99"
REAL_DISPLAY="${DISPLAY:-:0.0}"

mkdir -p "$HOME/android-re/captures" "$HOME/android-re/swagger"

echo "[1/7] Starting Xvfb virtual display (for emulator Qt backend)..."
pkill -f "Xvfb $XVFB_DISPLAY" 2>/dev/null; sleep 1
Xvfb "$XVFB_DISPLAY" -screen 0 1920x1080x24 > /tmp/xvfb.log 2>&1 &
sleep 2

echo "[2/7] Starting ADB server..."
adb kill-server 2>/dev/null
adb start-server
sleep 2

echo "[3/7] Starting Android emulator (KVM accelerated)..."
DISPLAY="$XVFB_DISPLAY" \
"$ANDROID_HOME/emulator/emulator" \
  -avd android-re \
  -no-window -no-audio \
  -gpu swiftshader_indirect \
  -accel on \
  -writable-system \
  -port 5554 \
  -no-metrics \
  > /tmp/emulator.log 2>&1 &

echo "    Waiting for ADB device..."
until adb devices 2>/dev/null | grep -q "emulator-5554.*device"; do
  sleep 3
done

echo "    Waiting for full boot..."
until [ "$(adb -s emulator-5554 shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do
  sleep 5
done
echo "    Booted."

echo "[4/7] Setting up system (root + overlayfs + cert + proxy)..."
adb -s emulator-5554 root > /dev/null 2>&1 && sleep 2
adb -s emulator-5554 remount > /dev/null 2>&1
adb -s emulator-5554 push "$HOME/android-re/${CERT_HASH}.0" \
  "/system/etc/security/cacerts/${CERT_HASH}.0" > /dev/null
adb -s emulator-5554 shell chmod 644 "/system/etc/security/cacerts/${CERT_HASH}.0"
adb -s emulator-5554 shell settings put global http_proxy "10.0.2.2:${MITM_PORT}"

echo "[5/7] Starting Frida server on device..."
adb -s emulator-5554 push "$HOME/android-re/frida-server" /data/local/tmp/frida-server \
  > /dev/null 2>/dev/null || true
adb -s emulator-5554 shell \
  "pkill frida-server 2>/dev/null; chmod 755 /data/local/tmp/frida-server; \
   nohup /data/local/tmp/frida-server > /dev/null 2>&1 &" > /dev/null 2>&1

echo "[6/7] Starting mitmweb (flows → ${FLOWS_FILE})..."
pkill -f mitmweb 2>/dev/null; sleep 1
mitmweb -p "${MITM_PORT}" \
  --web-port "${MITM_WEB_PORT}" \
  --web-host 0.0.0.0 \
  -w "${FLOWS_FILE}" \
  --no-web-open-browser \
  > /tmp/mitmweb.log 2>&1 &

echo "[7/7] Launching scrcpy (Android screen → your desktop)..."
sleep 2
DISPLAY="$REAL_DISPLAY" /usr/local/bin/scrcpy \
  -s emulator-5554 \
  --window-title "Android RE - Snapmap" \
  --max-size 1080 \
  --stay-awake \
  --no-audio \
  > /tmp/scrcpy.log 2>&1 &

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  Android RE Stack Running                            ║"
echo "║                                                      ║"
echo "║  scrcpy window  →  on your desktop                  ║"
echo "║  mitmweb UI     →  http://127.0.0.1:${MITM_WEB_PORT}          ║"
echo "║  Flows file     →  captures/${SESSION}.flows ║"
echo "║  ADB            →  emulator-5554                    ║"
echo "╠══════════════════════════════════════════════════════╣"
echo "║  Install APK:                                        ║"
echo "║    adb -s emulator-5554 install -r app.apk          ║"
echo "║  Launch with bypass:                                 ║"
echo "║    frida -D emulator-5554 \\                         ║"
echo "║      -l frida/device_spoof.js \\                     ║"
echo "║      -l frida/snapchat_bypass.js \\                  ║"
echo "║      -f com.snapchat.android --no-pause             ║"
echo "║  Generate Swagger from capture:                      ║"
echo "║    ./to_swagger.sh                                   ║"
echo "╚══════════════════════════════════════════════════════╝"
