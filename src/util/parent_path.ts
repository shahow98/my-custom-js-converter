/**
 * 获取父项目根路径
 * @returns 若被父项目依赖则返回父项目根目录,否则返回undefined
 */
export function getParentRootDir(): string | undefined {
  const curDir = __dirname;
  if (curDir.search(/node_modules.*/) === -1) {
    return undefined;
  }
  return curDir.replace(/node_modules.*/g, "");
}
