import fs from "fs";
import path from "path";
import { Dirent } from "fs";

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
    console.log(`路径不存在[${dirPath}]忽略`);
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
