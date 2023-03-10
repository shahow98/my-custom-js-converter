import fs from "fs";
import path from "path";

export function scanfCodeFiles(
  dirPaths: string | string[],
  filterName: string = ""
): string[] {
  if (dirPaths instanceof String) {
    return scanfCodeFiles$0(dirPaths as string, filterName);
  }
  if (dirPaths instanceof Array<string>) {
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
  const files = fs.readdirSync(dirPath, {
    encoding: "utf-8",
    withFileTypes: true
  });
  files
    .filter((file) => file.isFile())
    .filter((file) => file.name == filterName)
    .forEach(() => {
      filePaths.push(`${path.join(dirPath, filterName)}`);
    });
  files
    .filter((file) => file.isDirectory())
    .forEach((dir) => {
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
 *   - throw err
 * @param modPath - 引入路径
 * @returns
 */
export function scanfRequieMod(baseDir: string, modPath: string): string {
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