#!/usr/bin/env node

/**
 * 人工审批测试脚本
 *
 * 运行 encode → decode 流程，将原文件、编码后文件、解码后文件并排展示，
 * 由人工比对确认转换结果是否正确。
 *
 * 用法:
 *   node test/manual_review.js
 *   npm run test:manual
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');
const readline = require('readline');

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
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'converter-review-'));
  log('SETUP', `临时项目: ${tempDir}`);

  const srcDir = path.join(tempDir, 'src');
  const utilDir = path.join(srcDir, 'util');
  fs.mkdirSync(utilDir, { recursive: true });

  // 复制 fixture 源文件
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

  // 复制 config.json 并动态设置 baseDir
  const configPath = path.join(tempDir, 'config.json');
  fs.copyFileSync(
    path.join(FIXTURE_DIR, 'config.json'),
    configPath
  );
  const configData = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  configData.baseDir = tempDir;
  fs.writeFileSync(configPath, JSON.stringify(configData, null, 2), 'utf-8');

  // 创建 node_modules 符号链接
  const modDir = path.join(tempDir, 'node_modules', '@kezh', 'my-custom-js-converter');
  fs.mkdirSync(modDir, { recursive: true });

  const coreLink = path.join(modDir, 'core');
  if (os.platform() === 'win32') {
    fs.symlinkSync(COMPILED_CORE, coreLink, 'junction');
  } else {
    fs.symlinkSync(COMPILED_CORE, coreLink);
  }

  const pkgLink = path.join(modDir, 'package.json');
  if (os.platform() === 'win32') {
    fs.copyFileSync(path.join(PROJECT_ROOT, 'package.json'), pkgLink);
  } else {
    fs.symlinkSync(path.join(PROJECT_ROOT, 'package.json'), pkgLink);
  }

  log('SETUP', '临时项目创建完成');
}

function cleanup() {
  if (tempDir && fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    log('CLEANUP', `已清理 ${tempDir}`);
  }
}

function runEncode() {
  const encodeBin = path.join(tempDir, 'node_modules', '@kezh', 'my-custom-js-converter', 'core', 'encode', 'index.js');
  log('ENCODE', `执行: node ${encodeBin}`);
  const output = execSync(`node "${encodeBin}"`, {
    cwd: tempDir,
    encoding: 'utf-8',
    timeout: 30000
  });
  log('ENCODE', output);
}

function runDecode() {
  const decodeBin = path.join(tempDir, 'node_modules', '@kezh', 'my-custom-js-converter', 'core', 'decode', 'index.js');
  log('DECODE', `执行: node ${decodeBin}`);
  const output = execSync(`node "${decodeBin}"`, {
    cwd: tempDir,
    encoding: 'utf-8',
    timeout: 30000
  });
  log('DECODE', output);
}

// ─── Display helpers ─────────────────────────────────────────────────────────

const TERMINAL_COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgBlue: '\x1b[44m',
  bgGreen: '\x1b[42m',
  bgRed: '\x1b[41m',
  bgYellow: '\x1b[43m',
};

function color(text, ...colors) {
  return colors.join('') + text + TERMINAL_COLORS.reset;
}

function divider(title, width = 80) {
  const pad = Math.max(0, width - title.length - 2);
  const left = Math.floor(pad / 2);
  const right = pad - left;
  return color('─'.repeat(left) + ' ' + title + ' ' + '─'.repeat(right), TERMINAL_COLORS.dim);
}

function numberedLines(content) {
  const lines = content.split(/\r?\n/);
  const maxNum = lines.length;
  const width = String(maxNum).length;
  return lines.map((line, i) => {
    const num = String(i + 1).padStart(width, ' ');
    return color(num + ' │ ', TERMINAL_COLORS.dim) + line;
  }).join('\n');
}

function showFile(label, filePath) {
  console.log('\n' + divider(label));
  if (!fs.existsSync(filePath)) {
    console.log(color(`  文件不存在: ${filePath}`, TERMINAL_COLORS.red));
    return;
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  console.log(numberedLines(content));
  console.log(color(`  (${filePath})`, TERMINAL_COLORS.dim));
}

function showMapFile(filePath) {
  console.log('\n' + divider('mod.map (依赖映射)'));
  if (!fs.existsSync(filePath)) {
    console.log(color(`  文件不存在: ${filePath}`, TERMINAL_COLORS.red));
    return;
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  console.log(numberedLines(content));
  console.log(color(`  (${filePath})`, TERMINAL_COLORS.dim));
}

// ─── Interactive prompt ──────────────────────────────────────────────────────

function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise(resolve => {
    rl.question(query, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(color('╔══════════════════════════════════════════════════════════╗', TERMINAL_COLORS.cyan));
  console.log(color('║   my-custom-js-converter 人工审批测试                      ║', TERMINAL_COLORS.cyan));
  console.log(color('╚══════════════════════════════════════════════════════════╝', TERMINAL_COLORS.cyan));

  // 检查编译产物
  if (!fs.existsSync(COMPILED_CORE)) {
    console.error(color('\n错误: 项目未编译，请先运行 npm run build', TERMINAL_COLORS.red));
    process.exit(1);
  }

  try {
    // 1. 设置临时项目
    setupTempProject();

    // 2. 展示原始文件
    console.log('\n' + color('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', TERMINAL_COLORS.bold));
    console.log(color('  第一步: 查看原始文件', TERMINAL_COLORS.bold + TERMINAL_COLORS.bgBlue + TERMINAL_COLORS.white));
    console.log(color('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', TERMINAL_COLORS.bold));

    showFile('原始文件: src/index.js (入口)', path.join(tempDir, 'src', 'index.js'));
    showFile('原始文件: src/util/index.js (依赖模块)', path.join(tempDir, 'src', 'util', 'index.js'));
    showFile('原始文件: src/helper.js (依赖模块)', path.join(tempDir, 'src', 'helper.js'));

    await askQuestion(color('\n按 Enter 继续执行 encode ...', TERMINAL_COLORS.yellow));

    // 3. 执行 encode
    console.log('\n' + color('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', TERMINAL_COLORS.bold));
    console.log(color('  第二步: 执行 encode 并查看编码结果', TERMINAL_COLORS.bold + TERMINAL_COLORS.bgBlue + TERMINAL_COLORS.white));
    console.log(color('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', TERMINAL_COLORS.bold));

    runEncode();

    showFile('编码后: src/coded.js', path.join(tempDir, 'src', 'coded.js'));
    showMapFile(path.join(tempDir, 'src', '.setting', 'mod.map'));

    await askQuestion(color('\n按 Enter 继续执行 decode ...', TERMINAL_COLORS.yellow));

    // 4. 执行 decode
    console.log('\n' + color('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', TERMINAL_COLORS.bold));
    console.log(color('  第三步: 执行 decode 并查看解码结果', TERMINAL_COLORS.bold + TERMINAL_COLORS.bgBlue + TERMINAL_COLORS.white));
    console.log(color('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', TERMINAL_COLORS.bold));

    runDecode();

    showFile('解码后: src/decoded.js', path.join(tempDir, 'src', 'decoded.js'));

    // 5. 并排对比: 原始 vs 解码
    console.log('\n' + color('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', TERMINAL_COLORS.bold));
    console.log(color('  第四步: 原始文件 vs 解码文件 对比', TERMINAL_COLORS.bold + TERMINAL_COLORS.bgBlue + TERMINAL_COLORS.white));
    console.log(color('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', TERMINAL_COLORS.bold));

    const originalContent = fs.readFileSync(path.join(tempDir, 'src', 'index.js'), 'utf-8');
    const decodedContent = fs.readFileSync(path.join(tempDir, 'src', 'decoded.js'), 'utf-8');

    console.log('\n' + divider('原始文件: src/index.js'));
    console.log(numberedLines(originalContent));

    console.log('\n' + divider('解码文件: src/decoded.js'));
    console.log(numberedLines(decodedContent));

    // 6. 人工审批
    console.log('\n' + color('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', TERMINAL_COLORS.bold));
    console.log(color('  人工审批', TERMINAL_COLORS.bold + TERMINAL_COLORS.bgYellow + TERMINAL_COLORS.white));
    console.log(color('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', TERMINAL_COLORS.bold));

    console.log('\n请比对以上文件内容，确认转换结果是否正确:');
    console.log(color('  • 原始文件中的 require() 语句是否在解码后恢复', TERMINAL_COLORS.cyan));
    console.log(color('  • 编码后的 __modName 后缀是否在解码后正确移除', TERMINAL_COLORS.cyan));
    console.log(color('  • 依赖模块方法是否在解码后从内联中移除', TERMINAL_COLORS.cyan));
    console.log(color('  • 自身模块方法是否在编码/解码后保持不变', TERMINAL_COLORS.cyan));
    console.log(color('  • this.method() 调用是否正确还原为 dep.method()', TERMINAL_COLORS.cyan));

    const answer = await askQuestion(
      color('\n审批结果 [y=通过 / n=不通过 / s=跳过]: ', TERMINAL_COLORS.yellow)
    );

    if (answer.toLowerCase() === 'y') {
      console.log(color('\n✓ 人工审批通过', TERMINAL_COLORS.green));
    } else if (answer.toLowerCase() === 'n') {
      console.log(color('\n✗ 人工审批未通过', TERMINAL_COLORS.red));
      cleanup();
      process.exit(1);
    } else {
      console.log(color('\n- 人工审批已跳过', TERMINAL_COLORS.yellow));
    }

  } catch (err) {
    console.error(color('\n执行出错: ' + err.message, TERMINAL_COLORS.red));
    cleanup();
    process.exit(1);
  } finally {
    cleanup();
  }
}

main();
