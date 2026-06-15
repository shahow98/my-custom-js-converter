import fs from "fs";
import path from "path";

const VERSION_FILE = "version";
const VERSION_LOG_PREFIX = "__version__:";
const VERSION_METHOD_NAME = "onFormReady";
const INITIAL_VERSION = "00000001";

/**
 * 读取版本号，若版本文件不存在则创建并写入初始版本
 * @param settingDir - setting目录路径
 * @returns 当前版本号字符串
 */
export function readOrCreateVersion(settingDir: string): string {
  ensureDir(settingDir);
  const versionPath = path.join(settingDir, VERSION_FILE);
  if (fs.existsSync(versionPath)) {
    return fs.readFileSync(versionPath, { encoding: "utf-8" }).trim();
  }
  fs.writeFileSync(versionPath, INITIAL_VERSION, "utf-8");
  return INITIAL_VERSION;
}

/**
 * 递增版本号并写入版本文件
 * @param settingDir - setting目录路径
 */
export function incrementVersion(settingDir: string): void {
  const versionPath = path.join(settingDir, VERSION_FILE);
  const current = readOrCreateVersion(settingDir);
  const next = padVersion(parseInt(current, 10) + 1);
  fs.writeFileSync(versionPath, next, "utf-8");
}

/**
 * 写入版本号到版本文件
 * @param settingDir - setting目录路径
 * @param version - 版本号字符串
 */
export function writeVersion(settingDir: string, version: string): void {
  ensureDir(settingDir);
  const versionPath = path.join(settingDir, VERSION_FILE);
  fs.writeFileSync(versionPath, version, "utf-8");
}

/**
 * 生成版本日志语句
 * @param version - 版本号
 * @returns console.log("__version__: 00000001")
 */
export function versionLogStatement(version: string): string {
  return `console.log("${VERSION_LOG_PREFIX} ${version}");`;
}

/**
 * 从代码文本中提取版本日志中的版本号
 * @param code - 代码文本
 * @returns 版本号字符串，若不存在则返回null
 */
export function extractVersionFromCode(code: string): string | null {
  const regex = new RegExp(
    `console\\.log\\(["'\`]${VERSION_LOG_PREFIX}\\s+([\\d]+)["'\`]\\)`
  );
  const match = code.match(regex);
  return match ? match[1] : null;
}

/**
 * 从代码文本中移除版本日志行
 * @param code - 代码文本
 * @returns 移除版本日志后的代码
 */
export function removeVersionLogFromCode(code: string): string {
  const regex = new RegExp(
    `\\s*console\\.log\\(["'\`]${VERSION_LOG_PREFIX}\\s+[\\d]+["'\`]\\);?\\s*\\n?`
  );
  return code.replace(regex, "\n");
}

/**
 * 获取版本方法名
 */
export function getVersionMethodName(): string {
  return VERSION_METHOD_NAME;
}

/**
 * 获取版本日志前缀
 */
export function getVersionLogPrefix(): string {
  return VERSION_LOG_PREFIX;
}

function padVersion(num: number): string {
  return String(num).padStart(8, "0");
}

function ensureDir(dir: string): void {
  try {
    fs.accessSync(dir);
  } catch {
    fs.mkdirSync(dir, { recursive: true });
  }
}
