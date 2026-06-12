const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

// ─── Constants ───────────────────────────────────────────────────────────────
const PROJECT_ROOT = path.resolve(__dirname, '..');
const COMPILED_CORE = path.join(PROJECT_ROOT, 'core');
const FIXTURE_DIR = path.join(PROJECT_ROOT, 'test', 'fixtures', 'sample_project');

// ─── Helpers ─────────────────────────────────────────────────────────────────
let tempDir = '';

function log(section, msg) {
  console.log(`\n[${section}] ${msg}`);
}

function setupTempProject() {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'converter-test-'));
  log('SETUP', `Temp project: ${tempDir}`);

  // Create the parent project structure
  const srcDir = path.join(tempDir, 'src');
  const utilDir = path.join(srcDir, 'util');
  fs.mkdirSync(utilDir, { recursive: true });

  // Copy fixture source files
  fs.copyFileSync(
    path.join(FIXTURE_DIR, 'src', 'index.js'),
    path.join(srcDir, 'index.js')
  );
  fs.copyFileSync(
    path.join(FIXTURE_DIR, 'src', 'util', 'index.js'),
    path.join(utilDir, 'index.js')
  );
  fs.copyFileSync(
    path.join(FIXTURE_DIR, 'src', 'helper.js'),
    path.join(srcDir, 'helper.js')
  );

  // Copy config.json to parent project root
  fs.copyFileSync(
    path.join(FIXTURE_DIR, 'config.json'),
    path.join(tempDir, 'config.json')
  );

  // Create node_modules/@kezh/my-custom-js-converter symlink
  const modDir = path.join(tempDir, 'node_modules', '@kezh', 'my-custom-js-converter');
  fs.mkdirSync(modDir, { recursive: true });

  // Symlink the compiled core/ directory into the fake node_modules package
  const coreLink = path.join(modDir, 'core');
  if (os.platform() === 'win32') {
    // On Windows, use junction for directory symlinks (no admin needed)
    fs.symlinkSync(COMPILED_CORE, coreLink, 'junction');
  } else {
    fs.symlinkSync(COMPILED_CORE, coreLink);
  }

  // Also symlink package.json so the bin resolution works
  const pkgLink = path.join(modDir, 'package.json');
  if (os.platform() === 'win32') {
    // For files, just copy on Windows (symlink requires admin)
    fs.copyFileSync(path.join(PROJECT_ROOT, 'package.json'), pkgLink);
  } else {
    fs.symlinkSync(path.join(PROJECT_ROOT, 'package.json'), pkgLink);
  }

  log('SETUP', 'Fixture project created with node_modules symlink');
}

function cleanup() {
  if (tempDir && fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    log('CLEANUP', `Removed ${tempDir}`);
  }
}

function runEncode() {
  const encodeBin = path.join(tempDir, 'node_modules', '@kezh', 'my-custom-js-converter', 'core', 'encode', 'index.js');
  log('ENCODE', `Running: node ${encodeBin}`);
  const output = execSync(`node "${encodeBin}"`, {
    cwd: tempDir,
    encoding: 'utf-8',
    timeout: 30000
  });
  log('ENCODE', output);
  return output;
}

function runDecode() {
  const decodeBin = path.join(tempDir, 'node_modules', '@kezh', 'my-custom-js-converter', 'core', 'decode', 'index.js');
  log('DECODE', `Running: node ${decodeBin}`);
  const output = execSync(`node "${decodeBin}"`, {
    cwd: tempDir,
    encoding: 'utf-8',
    timeout: 30000
  });
  log('DECODE', output);
  return output;
}

// ─── Test Cases ──────────────────────────────────────────────────────────────

// --- Encode tests ---

function testEncodeOutputsExist() {
  log('TEST', 'Encode outputs exist');

  const codedPath = path.join(tempDir, 'src', 'coded.js');
  const mapPath = path.join(tempDir, 'src', '.setting', 'mod.map');

  assert.ok(fs.existsSync(codedPath), 'coded.js should exist after encode');
  assert.ok(fs.existsSync(mapPath), 'mod.map should exist after encode');

  log('TEST', '✓ coded.js and mod.map exist');
}

function testEncodeMapStructure() {
  log('TEST', 'Encode mod.map structure');

  const mapPath = path.join(tempDir, 'src', '.setting', 'mod.map');
  const map = JSON.parse(fs.readFileSync(mapPath, 'utf-8'));

  // Should have "self" key and dependency module keys
  assert.ok(map.self, 'mod.map should have "self" entry');
  assert.ok(map.self.dependencies, 'self should have dependencies');
  assert.ok(map.self.dependencies.util, 'self should depend on util');
  assert.ok(map.self.dependencies.helper, 'self should depend on helper');

  // Verify dependency method lists
  const utilMethods = map.self.dependencies.util.methods;
  const helperMethods = map.self.dependencies.helper.methods;
  assert.ok(utilMethods.includes('fetchData'), 'util dependency should include fetchData');
  assert.ok(utilMethods.includes('formatData'), 'util dependency should include formatData');
  assert.ok(helperMethods.includes('validate'), 'helper dependency should include validate');
  assert.ok(helperMethods.includes('transform'), 'helper dependency should include transform');

  // Verify util and helper module entries exist
  assert.ok(map.util, 'mod.map should have "util" entry');
  assert.ok(map.helper, 'mod.map should have "helper" entry');

  log('TEST', `✓ mod.map has keys: ${Object.keys(map).join(', ')}`);
}

function testEncodeMethodRenaming() {
  log('TEST', 'Encode method renaming (__modName suffix)');

  const codedPath = path.join(tempDir, 'src', 'coded.js');
  const coded = fs.readFileSync(codedPath, 'utf-8');

  // Encoded file should contain methods with __modName suffix
  assert.ok(coded.includes('__util'), 'Encoded file should contain __util suffix');
  assert.ok(coded.includes('__helper'), 'Encoded file should contain __helper suffix');

  // Specific renamed methods should exist
  assert.ok(coded.includes('fetchData__util'), 'fetchData__util should exist');
  assert.ok(coded.includes('formatData__util'), 'formatData__util should exist');
  assert.ok(coded.includes('validate__helper'), 'validate__helper should exist');
  assert.ok(coded.includes('transform__helper'), 'transform__helper should exist');

  log('TEST', '✓ Method renaming confirmed in coded.js');
}

function testEncodeSelfMethodsUnrenamed() {
  log('TEST', 'Encode self module methods keep original names');

  const codedPath = path.join(tempDir, 'src', 'coded.js');
  const coded = fs.readFileSync(codedPath, 'utf-8');

  // Self module methods (init, loadData, process) should NOT have __suffix
  assert.ok(coded.includes('init()'), 'init() should exist without suffix');
  assert.ok(coded.includes('loadData()'), 'loadData() should exist without suffix');
  assert.ok(coded.includes('process(name)'), 'process(name) should exist without suffix');

  log('TEST', '✓ Self module methods keep original names');
}

function testEncodeThisCallsRenamed() {
  log('TEST', 'Encode this.method() calls in self become this.method__dep()');

  const codedPath = path.join(tempDir, 'src', 'coded.js');
  const coded = fs.readFileSync(codedPath, 'utf-8');

  // In the self module, calls like util.formatData() become this.formatData__util()
  assert.ok(coded.includes('this.formatData__util'), 'this.formatData__util should exist');
  assert.ok(coded.includes('this.validate__helper'), 'this.validate__helper should exist');
  assert.ok(coded.includes('this.fetchData__util'), 'this.fetchData__util should exist');
  assert.ok(coded.includes('this.transform__helper'), 'this.transform__helper should exist');

  log('TEST', '✓ Dependency method calls renamed to this.method__dep()');
}

function testEncodeDependencyInternalCallsRenamed() {
  log('TEST', 'Encode this.method() inside dependency modules get __modName suffix');

  const codedPath = path.join(tempDir, 'src', 'coded.js');
  const coded = fs.readFileSync(codedPath, 'utf-8');

  // Inside util module, this.parseData() becomes this.parseData__util()
  assert.ok(coded.includes('this.parseData__util'), 'this.parseData__util should exist');
  // Inside helper module, this.check() becomes this.check__helper()
  assert.ok(coded.includes('this.check__helper'), 'this.check__helper should exist');

  log('TEST', '✓ Internal dependency method calls renamed correctly');
}

// --- Decode tests ---

function testDecodeOutputsExist() {
  log('TEST', 'Decode outputs exist');

  const decodedPath = path.join(tempDir, 'src', 'decoded.js');
  assert.ok(fs.existsSync(decodedPath), 'decoded.js should exist after decode');

  log('TEST', '✓ decoded.js exists');
}

function testDecodeRestoresRequire() {
  log('TEST', 'Decode restores require() statements');

  const decodedPath = path.join(tempDir, 'src', 'decoded.js');
  const decoded = fs.readFileSync(decodedPath, 'utf-8');

  // Decoded file should have require() calls for dependencies
  const hasRequire = decoded.includes('require(');
  assert.ok(hasRequire, 'Decoded file should contain require() statements');

  // Should have require for both util and helper
  assert.ok(decoded.includes('util') && decoded.includes('require('),
    'Decoded file should reference util in require');
  assert.ok(decoded.includes('helper') && decoded.includes('require('),
    'Decoded file should reference helper in require');

  log('TEST', '✓ require() statements restored in decoded.js');
}

function testDecodeRemovesInlinedMethods() {
  log('TEST', 'Decode removes inlined dependency methods');

  const decodedPath = path.join(tempDir, 'src', 'decoded.js');
  const decoded = fs.readFileSync(decodedPath, 'utf-8');

  // After decode, dependency methods with __modName should be removed
  const hasInlinedUtilMethods = /this\.\w+__util/.test(decoded);
  const hasInlinedHelperMethods = /this\.\w+__helper/.test(decoded);
  assert.ok(!hasInlinedUtilMethods, 'Decoded file should not have this.method__util patterns');
  assert.ok(!hasInlinedHelperMethods, 'Decoded file should not have this.method__helper patterns');

  // Dependency method definitions should be removed
  assert.ok(!decoded.includes('fetchData__util'), 'fetchData__util definition should be removed');
  assert.ok(!decoded.includes('validate__helper'), 'validate__helper definition should be removed');

  log('TEST', '✓ Inlined dependency methods removed from decoded.js');
}

function testDecodeRestoresMethodNames() {
  log('TEST', 'Decode restores original method names');

  const decodedPath = path.join(tempDir, 'src', 'decoded.js');
  const decoded = fs.readFileSync(decodedPath, 'utf-8');

  // The decoded file should reference dependency methods via depName.method()
  assert.ok(decoded.includes('util.formatData') || decoded.includes('util.fetchData'),
    'Decoded file should call util methods via util.method()');
  assert.ok(decoded.includes('helper.validate') || decoded.includes('helper.transform'),
    'Decoded file should call helper methods via helper.method()');

  log('TEST', '✓ Original method call patterns restored in decoded.js');
}

function testDecodeMountVariable() {
  log('TEST', 'Decode creates mount variable');

  const decodedPath = path.join(tempDir, 'src', 'decoded.js');
  const decoded = fs.readFileSync(decodedPath, 'utf-8');

  // The decoded file should have the mount variable (customEvent)
  assert.ok(decoded.includes('customEvent'), 'Decoded file should contain the mount variable "customEvent"');
  assert.ok(decoded.includes('module.exports = customEvent'), 'Decoded file should export customEvent');

  log('TEST', '✓ Mount variable "customEvent" present in decoded.js');
}

function testDecodeSelfMethodsPreserved() {
  log('TEST', 'Decode preserves self module methods');

  const decodedPath = path.join(tempDir, 'src', 'decoded.js');
  const decoded = fs.readFileSync(decodedPath, 'utf-8');

  // Self module methods should still be present
  assert.ok(decoded.includes('init()'), 'init() should be preserved');
  assert.ok(decoded.includes('loadData()'), 'loadData() should be preserved');
  assert.ok(decoded.includes('process(name)'), 'process(name) should be preserved');

  log('TEST', '✓ Self module methods preserved in decoded.js');
}

function testDecodeNoDoubleSuffix() {
  log('TEST', 'Decode does not leave any __modName suffixes');

  const decodedPath = path.join(tempDir, 'src', 'decoded.js');
  const decoded = fs.readFileSync(decodedPath, 'utf-8');

  // No method names should have __suffix pattern remaining
  const hasDoubleUnderscoreSuffix = /\w+__(util|helper)/.test(decoded);
  assert.ok(!hasDoubleUnderscoreSuffix, 'Decoded file should not contain any __modName suffixes');

  log('TEST', '✓ No __modName suffixes remain in decoded.js');
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  my-custom-js-converter Integration Tests');
  console.log('═══════════════════════════════════════════════════════');

  let passed = 0;
  let failed = 0;
  const errors = [];

  // Ensure project is built
  if (!fs.existsSync(COMPILED_CORE)) {
    console.error('\nERROR: Project not built. Run "pnpm build" first.');
    process.exit(1);
  }

  try {
    // Setup
    setupTempProject();

    // ── Encode tests ──
    log('PHASE', '═══ ENCODE ═══');
    try {
      runEncode();
    } catch (err) {
      console.error('Encode command failed:', err.message);
      throw err;
    }

    const encodeTests = [
      testEncodeOutputsExist,
      testEncodeMapStructure,
      testEncodeMethodRenaming,
      testEncodeSelfMethodsUnrenamed,
      testEncodeThisCallsRenamed,
      testEncodeDependencyInternalCallsRenamed,
    ];

    for (const test of encodeTests) {
      try {
        test();
        passed++;
      } catch (err) {
        failed++;
        errors.push({ test: test.name, error: err.message });
        console.error(`  ✗ ${test.name}: ${err.message}`);
      }
    }

    // ── Decode tests ──
    log('PHASE', '═══ DECODE ═══');
    try {
      runDecode();
    } catch (err) {
      console.error('Decode command failed:', err.message);
      throw err;
    }

    const decodeTests = [
      testDecodeOutputsExist,
      testDecodeRestoresRequire,
      testDecodeRemovesInlinedMethods,
      testDecodeRestoresMethodNames,
      testDecodeMountVariable,
      testDecodeSelfMethodsPreserved,
      testDecodeNoDoubleSuffix,
    ];

    for (const test of decodeTests) {
      try {
        test();
        passed++;
      } catch (err) {
        failed++;
        errors.push({ test: test.name, error: err.message });
        console.error(`  ✗ ${test.name}: ${err.message}`);
      }
    }

  } catch (err) {
    failed++;
    errors.push({ test: 'setup/run', error: err.message });
  } finally {
    cleanup();
  }

  // ── Summary ──
  console.log('\n═══════════════════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('═══════════════════════════════════════════════════════');

  if (errors.length) {
    console.log('\nFailures:');
    errors.forEach((e, i) => console.log(`  ${i + 1}. ${e.test}: ${e.error}`));
  }

  process.exit(failed > 0 ? 1 : 0);
}

main();
