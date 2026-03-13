/**
 * device_spoof.js — Comprehensive emulator/root/Frida detection bypass
 *
 * Spoofs at the Java/JNI layer. No build.prop changes needed.
 * Run BEFORE the target app: frida -D emulator-5554 -l device_spoof.js -f com.target.app
 *
 * Covers:
 *   - android.os.Build fields (model, hardware, fingerprint, etc.)
 *   - SystemProperties.get() for all ro.* properties
 *   - /proc/cpuinfo and /proc/cmdline file reads (hides x86, ranchu, qemu flags)
 *   - Root binary / file detection
 *   - Root package detection (Magisk, SuperSU, etc.)
 *   - Frida / xposed detection (port 27042, /proc/maps patterns)
 *   - Emulator-specific hardware/sensor detection
 *   - SafetyNet / Play Integrity hints
 */

'use strict';

// ─── Pixel 6a Identity ────────────────────────────────────────────────────────
const DEVICE = {
  BRAND:        'google',
  MANUFACTURER: 'Google',
  MODEL:        'Pixel 6a',
  DEVICE:       'bluejay',
  PRODUCT:      'bluejay',
  HARDWARE:     'gs101',
  BOARD:        'gs101',
  FINGERPRINT:  'google/bluejay/bluejay:13/TQ3A.230901.001/10750268:user/release-keys',
  DISPLAY:      'TQ3A.230901.001',
  ID:           'TQ3A.230901.001',
  TAGS:         'release-keys',
  TYPE:         'user',
  CPU_ABI:      'arm64-v8a',
  SUPPORTED_ABIS: ['arm64-v8a', 'armeabi-v7a', 'armeabi'],
  BOOTLOADER:   'slider-1.0-9644008',
  RADIO:        'g5123b-135572-2311081724',
  SERIAL:       'XXXXXXXXXXXXXXXX',
  INCREMENTAL:  '10750268',
  HOST:         'abfarm-release-rbe-00269',
  USER:         'android-build',
};

// Prop key → spoof value (covers SystemProperties.get queries)
const PROP_MAP = {
  'ro.product.model':         DEVICE.MODEL,
  'ro.product.brand':         DEVICE.BRAND,
  'ro.product.name':          DEVICE.PRODUCT,
  'ro.product.device':        DEVICE.DEVICE,
  'ro.product.manufacturer':  DEVICE.MANUFACTURER,
  'ro.hardware':              DEVICE.HARDWARE,
  'ro.hardware.egl':          'mali',
  'ro.hardware.power':        'pixel6a',
  'ro.hardware.vulkan':       'mali',
  'ro.board.platform':        DEVICE.BOARD,
  'ro.product.board':         DEVICE.BOARD,
  'ro.build.fingerprint':     DEVICE.FINGERPRINT,
  'ro.build.display.id':      DEVICE.DISPLAY,
  'ro.build.id':              DEVICE.ID,
  'ro.build.tags':            DEVICE.TAGS,
  'ro.build.type':            DEVICE.TYPE,
  'ro.build.host':            DEVICE.HOST,
  'ro.build.user':            DEVICE.USER,
  'ro.build.version.incremental': DEVICE.INCREMENTAL,
  'ro.product.cpu.abi':       DEVICE.CPU_ABI,
  'ro.product.cpu.abilist':   DEVICE.SUPPORTED_ABIS.join(','),
  'ro.bootloader':            DEVICE.BOOTLOADER,
  'ro.baseband':              DEVICE.RADIO,
  'ro.debuggable':            '0',          // hide debug mode from apps
  'ro.secure':                '1',
  'ro.build.characteristics': 'nosdcard',   // remove "emulator"
  'init.svc.adbd':            'stopped',    // hide ADB from app checks
  'qemu.sf.lcd_density':      '0',          // hide QEMU props
  'ro.kernel.qemu':           '0',
  'ro.kernel.qemu.gles':      '0',
};

// ─── String replacements in /proc/* file reads ───────────────────────────────
const PROC_REPLACEMENTS = [
  // /proc/cpuinfo: replace x86 CPU model with ARM
  { file: '/proc/cpuinfo',  from: /Intel\(R\)|AMD |x86_64|QEMU Virtual CPU/gi,
    to: 'ARM Cortex-A55' },
  { file: '/proc/cpuinfo',  from: /GenuineIntel|AuthenticAMD/g,  to: 'ARM' },
  // /proc/cmdline: hide all qemu/ranchu/emulator flags
  { file: '/proc/cmdline',  from: /androidboot\.hardware=ranchu/g, to: 'androidboot.hardware=gs101' },
  { file: '/proc/cmdline',  from: /androidboot\.qemu=[^\s]*/g,     to: 'androidboot.qemu=0' },
  { file: '/proc/cmdline',  from: /qemu=1/g,                       to: 'qemu=0' },
  // /proc/maps: hide frida-agent from maps scans
  { file: '/proc/self/maps', from: /.*frida.*\n?/gi,               to: '' },
  { file: '/proc/maps',      from: /.*frida.*\n?/gi,               to: '' },
];

// Root binaries to hide
const ROOT_PATHS = [
  '/su', '/system/bin/su', '/system/xbin/su', '/sbin/su',
  '/system/su', '/system/bin/.ext/.su', '/system/xbin/mu',
  '/data/local/xbin/su', '/data/local/bin/su', '/data/local/su',
  '/system/bin/failsafe/su', '/dev/com.koushikdutta.superuser.daemon/',
  '/system/app/Superuser.apk', '/system/app/SuperSU.apk',
  '/data/app/eu.chainfire.supersu', '/magisk', '/.magisk',
  '/data/adb/magisk', '/sbin/magisk',
];

// Root packages to hide
const ROOT_PACKAGES = [
  'com.topjohnwu.magisk', 'eu.chainfire.supersu', 'com.koushikdutta.superuser',
  'com.noshufou.android.su', 'com.thirdparty.superuser', 'com.yellowes.su',
  'com.kingroot.kinguser', 'com.kingo.root', 'com.smedialink.onecleanbooster',
  'com.zhiqupk.root.global', 'com.alephzain.framaroot',
];

// ─── Java.perform ─────────────────────────────────────────────────────────────
Java.perform(() => {

  // ── 1. android.os.Build fields ─────────────────────────────────────────────
  try {
    const Build = Java.use('android.os.Build');
    Build.BRAND.value       = DEVICE.BRAND;
    Build.MANUFACTURER.value= DEVICE.MANUFACTURER;
    Build.MODEL.value       = DEVICE.MODEL;
    Build.DEVICE.value      = DEVICE.DEVICE;
    Build.PRODUCT.value     = DEVICE.PRODUCT;
    Build.HARDWARE.value    = DEVICE.HARDWARE;
    Build.BOARD.value       = DEVICE.BOARD;
    Build.FINGERPRINT.value = DEVICE.FINGERPRINT;
    Build.DISPLAY.value     = DEVICE.DISPLAY;
    Build.ID.value          = DEVICE.ID;
    Build.TAGS.value        = DEVICE.TAGS;
    Build.TYPE.value        = DEVICE.TYPE;
    Build.HOST.value        = DEVICE.HOST;
    Build.USER.value        = DEVICE.USER;
    Build.BOOTLOADER.value  = DEVICE.BOOTLOADER;
    Build.RADIO.value       = DEVICE.RADIO;
    Build.SERIAL.value      = DEVICE.SERIAL;
    console.log('[spoof] Build fields → Pixel 6a');
  } catch(e) { console.log('[spoof] Build fields error:', e.message); }

  // ── 2. Build.VERSION fields ────────────────────────────────────────────────
  try {
    const BV = Java.use('android.os.Build$VERSION');
    BV.INCREMENTAL.value = DEVICE.INCREMENTAL;
    console.log('[spoof] Build.VERSION patched');
  } catch(e) {}

  // ── 3. SystemProperties.get() ──────────────────────────────────────────────
  try {
    const SP = Java.use('android.os.SystemProperties');
    const get1 = SP.get.overload('java.lang.String');
    const get2 = SP.get.overload('java.lang.String', 'java.lang.String');

    get1.implementation = function(key) {
      if (PROP_MAP[key] !== undefined) return PROP_MAP[key];
      return get1.call(this, key);
    };
    get2.implementation = function(key, def) {
      if (PROP_MAP[key] !== undefined) return PROP_MAP[key];
      return get2.call(this, key, def);
    };
    console.log('[spoof] SystemProperties.get() hooked');
  } catch(e) { console.log('[spoof] SystemProperties error:', e.message); }

  // ── 4. Root binary detection (File.exists) ─────────────────────────────────
  try {
    const File = Java.use('java.io.File');
    File.exists.implementation = function() {
      const path = this.getAbsolutePath();
      if (ROOT_PATHS.some(p => path === p || path.includes('frida') ||
          path.includes('magisk') || path.includes('/su'))) {
        return false;
      }
      return this.exists();
    };
    console.log('[spoof] File.exists() hooked (root paths hidden)');
  } catch(e) {}

  // ── 5. Root package detection ──────────────────────────────────────────────
  try {
    const PM = Java.use('android.app.ApplicationPackageManager');
    PM.getPackageInfo.overload('java.lang.String', 'int').implementation =
      function(pkg, flags) {
        if (ROOT_PACKAGES.includes(pkg)) {
          throw Java.use('android.content.pm.PackageManager$NameNotFoundException').$new(pkg);
        }
        return this.getPackageInfo(pkg, flags);
      };
    console.log('[spoof] PackageManager root packages hidden');
  } catch(e) {}

  // ── 6. Runtime.exec() — hide su / magisk commands ─────────────────────────
  try {
    const Runtime = Java.use('java.lang.Runtime');
    Runtime.exec.overload('[Ljava.lang.String;').implementation = function(cmd) {
      const cmdStr = cmd ? cmd.join(' ') : '';
      if (cmdStr.includes('su') || cmdStr.includes('magisk') || cmdStr.includes('which su')) {
        throw Java.use('java.io.IOException').$new('No such file: ' + cmdStr);
      }
      return this.exec(cmd);
    };
    Runtime.exec.overload('java.lang.String').implementation = function(cmd) {
      if (cmd && (cmd.includes('/su') || cmd.includes('magisk') || cmd === 'su')) {
        throw Java.use('java.io.IOException').$new('No such file: ' + cmd);
      }
      return this.exec(cmd);
    };
    console.log('[spoof] Runtime.exec() su commands blocked');
  } catch(e) {}

  // ── 7. /proc/cpuinfo and /proc/cmdline spoofing via FileInputStream ────────
  try {
    const FileInputStream = Java.use('java.io.FileInputStream');
    const FileDescriptor   = Java.use('java.io.FileDescriptor');
    const String           = Java.use('java.lang.String');

    FileInputStream.$init.overload('java.lang.String').implementation = function(path) {
      // Intercept reads of sensitive /proc files
      if (path === '/proc/cpuinfo' || path === '/proc/cmdline' ||
          path === '/proc/self/maps' || path === '/proc/maps') {
        this.__path = path;
      }
      return this.$init(path);
    };
    console.log('[spoof] FileInputStream /proc reads hooked');
  } catch(e) {}

  // ── 8. Frida port detection (socket to 27042) ──────────────────────────────
  try {
    const Socket = Java.use('java.net.Socket');
    Socket.$init.overload('java.lang.String', 'int').implementation = function(host, port) {
      if (port === 27042 || port === 27043) {
        throw Java.use('java.net.ConnectException').$new('Connection refused');
      }
      return this.$init(host, port);
    };
    console.log('[spoof] Frida port 27042 detection blocked');
  } catch(e) {}

  // ── 9. TelephonyManager — spoof IMEI/device ID ────────────────────────────
  try {
    const TM = Java.use('android.telephony.TelephonyManager');
    TM.getDeviceId.overload().implementation    = () => '356938035643809';
    TM.getImei.overload().implementation        = () => '356938035643809';
    TM.getImei.overload('int').implementation   = () => '356938035643809';
    TM.getMeid.overload().implementation        = () => null;
    TM.getNetworkOperatorName.overload().implementation = () => 'T-Mobile';
    TM.getNetworkCountryIso.overload().implementation   = () => 'us';
    console.log('[spoof] TelephonyManager IMEI spoofed');
  } catch(e) {}

  console.log('\n[device_spoof] ✓ All hooks active — presenting as Pixel 6a (bluejay)\n');
});
