/**
 * snapchat_bypass.js
 * Bypasses for Snapchat on Android emulator:
 *   - SSL certificate pinning (OkHttp, TrustManager, conscrypt)
 *   - Root detection
 *   - Emulator/VM detection
 *
 * Usage:
 *   frida -D emulator-5554 -l snapchat_bypass.js -f com.snapchat.android --no-pause
 */

'use strict';

// ─── SSL Pinning Bypass ───────────────────────────────────────────────────────

// 1. Null out X509TrustManager checks
const TrustManagerImpl = Java.use('com.android.org.conscrypt.TrustManagerImpl');
TrustManagerImpl.verifyChain.overload(
  'java.util.List', 'java.lang.String', 'java.lang.String',
  'boolean', 'boolean', 'boolean'
).implementation = function () {
  return this.getTrustAnchor(...arguments);
};

// 2. Generic TrustManager - accept all certs
const X509TrustManager = Java.use('javax.net.ssl.X509TrustManager');
const SSLContext = Java.use('javax.net.ssl.SSLContext');

const TrustAllCerts = Java.registerClass({
  name: 'com.re.TrustAllCerts',
  implements: [X509TrustManager],
  methods: {
    checkClientTrusted: function (chain, authType) {},
    checkServerTrusted: function (chain, authType) {},
    getAcceptedIssuers: function () { return []; },
  }
});

Java.perform(function () {
  // 3. OkHttp3 CertificatePinner bypass
  try {
    const CertificatePinner = Java.use('okhttp3.CertificatePinner');
    CertificatePinner.check.overload('java.lang.String', 'java.util.List')
      .implementation = function () {
        console.log('[bypass] OkHttp3 CertificatePinner.check() → skipped');
      };
    CertificatePinner.check.overload('java.lang.String', 'kotlin.jvm.functions.Function0')
      .implementation = function () {
        console.log('[bypass] OkHttp3 CertificatePinner.check() kotlin → skipped');
      };
  } catch (e) { /* OkHttp not present or different version */ }

  // 4. Conscrypt / BoringSSL TrustManager
  try {
    const ctx = SSLContext.getInstance('TLS');
    ctx.init(null, [TrustAllCerts.$new()], null);
    SSLContext.getDefault.implementation = function () { return ctx; };
    console.log('[bypass] SSLContext replaced with trust-all');
  } catch (e) {
    console.log('[bypass] SSLContext override failed:', e.message);
  }

  // 5. Snapchat's custom SSL verifier (varies by version)
  ['com.snapchat.client.httpclient.SnapHttpsVerifier',
   'com.snapchat.android.lib.http.SnapchatSslSocketFactory',
  ].forEach(function (cls) {
    try {
      const C = Java.use(cls);
      C.verify.overload('java.lang.String', 'javax.net.ssl.SSLSession')
        .implementation = function () { return true; };
      console.log('[bypass] Patched', cls);
    } catch (e) { /* class not found in this version */ }
  });

  // ─── Root Detection Bypass ──────────────────────────────────────────────────

  // Hide su binary
  const File = Java.use('java.io.File');
  File.exists.implementation = function () {
    const path = this.getAbsolutePath();
    if (path.includes('/su') || path.includes('supersu') || path.includes('magisk')) {
      console.log('[bypass] File.exists() → false for:', path);
      return false;
    }
    return this.exists();
  };

  // Hide root packages
  const PackageManager = Java.use('android.app.ApplicationPackageManager');
  PackageManager.getPackageInfo.overload('java.lang.String', 'int')
    .implementation = function (pkg, flags) {
      const rootPkgs = ['com.topjohnwu.magisk', 'com.koushikdutta.superuser',
                        'com.noshufou.android.su', 'eu.chainfire.supersu'];
      if (rootPkgs.includes(pkg)) {
        throw Java.use('android.content.pm.PackageManager$NameNotFoundException').$new();
      }
      return this.getPackageInfo(pkg, flags);
    };

  // ─── Emulator Detection Bypass ─────────────────────────────────────────────

  const Build = Java.use('android.os.Build');
  Build.FINGERPRINT.value = 'google/walleye/walleye:8.1.0/OPM1.171019.011/4448085:user/release-keys';
  Build.MODEL.value = 'Pixel 2';
  Build.MANUFACTURER.value = 'Google';
  Build.BRAND.value = 'google';
  Build.DEVICE.value = 'walleye';
  Build.PRODUCT.value = 'walleye';
  Build.HARDWARE.value = 'walleye';
  Build.TAGS.value = 'release-keys';

  console.log('[bypass] Snapchat bypass script loaded');
  console.log('[bypass] Build identity spoofed → Pixel 2');
  console.log('[bypass] Root detection → disabled');
  console.log('[bypass] SSL pinning → disabled');
});
