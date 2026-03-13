#!/usr/bin/env bash
# patch_apk.sh — Remove network_security_config SSL pinning from an APK and re-sign
# Usage: ./patch_apk.sh <input.apk> [output_patched.apk]

set -e

INPUT="${1:?Usage: $0 <input.apk> [output.apk]}"
OUTPUT="${2:-${INPUT%.apk}_patched.apk}"
WORK_DIR="$(mktemp -d /tmp/apkpatch.XXXX)"
KEYSTORE="$HOME/android-re/debug.keystore"

echo "[1/5] Decompiling: $INPUT"
apktool d -f "$INPUT" -o "$WORK_DIR/apk" 2>&1 | grep -E "^I:|error" || true

echo "[2/5] Patching network_security_config..."

# Remove pinning from network_security_config.xml if present
NSC="$WORK_DIR/apk/res/xml/network_security_config.xml"
if [ -f "$NSC" ]; then
  echo "  Found $NSC — removing pin-set entries"
  python3 - "$NSC" <<'PYEOF'
import sys, re
with open(sys.argv[1]) as f:
    content = f.read()
# Remove all <pin-set> blocks
content = re.sub(r'<pin-set[^>]*>.*?</pin-set>', '', content, flags=re.DOTALL)
# Remove <trustkit-config> blocks
content = re.sub(r'<trustkit-config[^>]*>.*?</trustkit-config>', '', content, flags=re.DOTALL)
with open(sys.argv[1], 'w') as f:
    f.write(content)
print("  Patched network_security_config.xml")
PYEOF
else
  echo "  No network_security_config.xml found (may use code-based pinning only)"
fi

# Add user cert trust if base-config exists, otherwise create trust-all config
MANIFEST="$WORK_DIR/apk/AndroidManifest.xml"
if grep -q "networkSecurityConfig\|network_security_config" "$MANIFEST" 2>/dev/null; then
  echo "  network_security_config referenced in manifest - already patched"
else
  echo "  Injecting network_security_config into manifest..."
  mkdir -p "$WORK_DIR/apk/res/xml"
  cat > "$WORK_DIR/apk/res/xml/network_security_config.xml" << 'XML'
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="true">
        <trust-anchors>
            <certificates src="system"/>
            <certificates src="user"/>
        </trust-anchors>
    </base-config>
</network-security-config>
XML
  # Inject attribute into application tag in manifest
  sed -i 's/<application /<application android:networkSecurityConfig="@xml\/network_security_config" /' "$MANIFEST"
fi

echo "[3/5] Rebuilding APK..."
apktool b "$WORK_DIR/apk" -o "$WORK_DIR/unsigned.apk" 2>&1 | grep -E "^I:|error" || true

echo "[4/5] Signing APK..."
if [ ! -f "$KEYSTORE" ]; then
  echo "  Generating debug keystore..."
  keytool -genkey -v -keystore "$KEYSTORE" \
    -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass android -keypass android \
    -dname "CN=Android Debug,O=Android,C=US" 2>/dev/null
fi

# Align and sign
zipalign -v 4 "$WORK_DIR/unsigned.apk" "$WORK_DIR/aligned.apk" > /dev/null
apksigner sign \
  --ks "$KEYSTORE" \
  --ks-pass pass:android \
  --key-pass pass:android \
  --ks-key-alias androiddebugkey \
  --out "$OUTPUT" \
  "$WORK_DIR/aligned.apk"

echo "[5/5] Done → $OUTPUT"
echo ""
echo "Install with:"
echo "  adb -s emulator-5554 install -r \"$OUTPUT\""

rm -rf "$WORK_DIR"
