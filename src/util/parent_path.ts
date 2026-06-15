/**
 * 获取父项目根路径
 * @returns 若被父项目依赖则返回父项目根目录,否则返回undefined
 */
export function getParentRootDir(): string | undefined {
  const curDir = __dirname;
  if (curDir.includes("node_modules")) {
    return curDir.replace(/node_modules.*/g, "");
  }
  // 当 __dirname 不包含 node_modules 时（如 junction symlink 场景），
  // 使用 config.baseDir 作为项目根目录
  const { config } = require("../config");
  return config.baseDir || undefined;
}
