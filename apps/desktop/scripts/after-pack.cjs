#!/usr/bin/env node
/**
 * afterPack: the last chance to shape the app directory before the installer
 * is built.
 *
 * 1. Keep only the target platform's sherpa-onnx addon — see prune-sherpa.cjs.
 *
 * 2. **macOS only:** ad-hoc sign the bundle — see adhoc-sign-mac.cjs. Without
 *    a Developer ID the app ships unsigned, and a downloaded (quarantined)
 *    copy is reported as "已损坏" by Gatekeeper instead of the standard
 *    "无法验证开发者" prompt the user can bypass.
 *
 * The plugin market used to be copied here on Windows (electron-builder's own
 * copy of the com.pi.files zip hit EBUSY on the runners). It is no longer
 * bundled at all: the installer ships no market snapshot, and plugins download
 * from their releases on first use.
 */
const pruneSherpa = require('./prune-sherpa.cjs');
const adhocSignMac = require('./adhoc-sign-mac.cjs');

module.exports = async function afterPack(context) {
  await pruneSherpa(context);
  adhocSignMac(context);
};
