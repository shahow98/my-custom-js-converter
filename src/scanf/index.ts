import fs from "fs";
import path from "path";
import { Dirent } from "fs";
import { createLogger } from "../util/logger";

const logger = createLogger("scanf");

export function scanfCodeFiles(
  dirPaths: string | string[],
  filterName: string = ""
): string[] {
  if (typeof dirPaths === "string") {
    return scanfCodeFiles$0(dirPaths, filterName);
  }
  if (Array.isArray(dirPaths)) {
    return (dirPaths as string[]).flatMap((p) =>
      scanfCodeFiles$0(p, filterName)
    );
  }
  return [];
}

function scanfCodeFiles$0(dirPath: string, filterName: string = ""): string[] {
  const filePaths: string[] = [];
  if (!fs.existsSync(dirPath)) {
    logger.warn(`dir not found, skipping: ${dirPath}`);
    return filePaths;
  }
  const files: Dirent[] = fs.readdirSync(dirPath, {
    encoding: "utf-8",
    withFileTypes: true
  });
  files
    .filter((file: Dirent) => file.isFile())
    .filter((file: Dirent) => file.name == filterName)
    .forEach(() => {
      filePaths.push(`${path.join(dirPath, filterName)}`);
    });
  files
    .filter((file: Dirent) => file.isDirectory())
    .forEach((dir: Dirent) => {
      filePaths.push(
        ...scanfCodeFiles$0(`${path.join(dirPath, dir.name)}`, filterName)
      );
    });
  return filePaths;
}

export function scanfCodeDirs(baseDir: string, targetDirs: string[]): string[] {
  const dirs = new Set(targetDirs);
  return [...dirs].map(
    (dir) => `${path.join(baseDir, dir.replace(/\/|\\/, path.sep))}`
  );
}

/**
 * 将 libs 配置解析为绝对路径数组
 * 支持 "@/util" 别名路径（@ 代表项目根目录 rootDir）和 "util" 相对 baseDir 路径
 * @param libs - libs 配置数组
 * @param baseDir - 基础目录（相对路径的基准）
 * @param rootDir - 项目根目录（@ 别名的基准，未提供时 @ 路径会被跳过并警告）
 * @returns 绝对路径数组
 */
export function resolveLibDirs(
  libs: string[],
  baseDir: string,
  rootDir?: string
): string[] {
  return libs
    .map((lib) => {
      if (lib.startsWith("@/") || lib.startsWith("@\\")) {
        if (!rootDir) {
          logger.warn(`@ 别名路径需要 rootDir，已跳过: ${lib}`);
          return "";
        }
        const sub = lib.replace(/^@[/\\]/, "");
        return path.join(rootDir.replace(/[\\/]$/, ""), sub);
      }
      return path.join(baseDir, lib.replace(/\/|\\/, path.sep));
    })
    .filter((dir) => dir !== "");
}

/**
 * 在 libs 目录下搜索依赖模块文件
 * 查找 modName.js（文件）和 modName/index.js（目录下入口）
 * @param libDirs - 已解析的绝对路径目录数组
 * @param modName - 依赖模块名（如 "drawer"）
 * @returns 所有匹配的绝对路径数组
 */
export function scanfLibMod(libDirs: string[], modName: string): string[] {
  const results: string[] = [];
  const seen = new Set<string>();
  libDirs.forEach((libDir) => {
    if (!fs.existsSync(libDir)) {
      return;
    }
    // 1. libDir/modName.js
    const filePath = path.join(libDir, `${modName}.js`);
    if (fs.existsSync(filePath) && !seen.has(filePath)) {
      seen.add(filePath);
      results.push(filePath);
    }
    // 2. libDir/modName/index.js（modName 为子目录）
    const subDir = path.join(libDir, modName);
    if (fs.existsSync(subDir) && fs.statSync(subDir).isDirectory()) {
      const indexFile = path.join(subDir, "index.js");
      if (fs.existsSync(indexFile) && !seen.has(indexFile)) {
        seen.add(indexFile);
        results.push(indexFile);
      }
    }
    // 3. 递归搜索子目录（通用方法可能嵌套在子目录下）
    const subDirs = fs
      .readdirSync(libDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => path.join(libDir, d.name));
    subDirs.forEach((sub) => {
      const nested = scanfLibMod([sub], modName);
      nested.forEach((p) => {
        if (!seen.has(p)) {
          seen.add(p);
          results.push(p);
        }
      });
    });
  });
  return results;
}

/**
 * 扫描引入路径
 * require('../../util')
 *   - is dir ../../util/index.js
 *   - is file ../../util.js
 * require('@/util')
 *   - @ 代表项目根目录(rootDir)，解析为 rootDir/util
 *   - is dir rootDir/util/index.js
 *   - is file rootDir/util.js
 *   - throw err
 * @param baseDir - 基础目录（当前文件所在目录，用于相对路径解析）
 * @param modPath - 引入路径
 * @param rootDir - 项目根目录（用于 @ 别名解析，若未提供则 @ 路径无法解析）
 * @returns
 */
export function scanfRequieMod(baseDir: string, modPath: string, rootDir?: string): string {
  // 支持 @ 别名：@/xxx => rootDir/xxx
  if (modPath.startsWith("@/") || modPath.startsWith("@\\")) {
    if (!rootDir) {
      throw new Error(`@ 别名路径需要配置 rootDir，请检查 config.js 中 useAlias 是否开启`);
    }
    modPath = modPath.replace(/^@[/\\]/, "");
    baseDir = rootDir.replace(/[\\/]$/, "");
  }
  let absolutePath = path.join(baseDir, modPath);
  try {
    fs.accessSync(absolutePath, fs.constants.R_OK);
  } catch (err) {
    try {
      fs.accessSync(absolutePath, fs.constants.O_DIRECTORY);
      absolutePath = path.join(absolutePath, "index.js");
      fs.accessSync(absolutePath, fs.constants.F_OK);
    } catch (err) {
      try {
        absolutePath = `${absolutePath}.js`;
        fs.accessSync(absolutePath, fs.constants.F_OK);
      } catch (err) {
        throw new Error(`${absolutePath} is not exists!`);
      }
    }
  }
  return absolutePath;
}
