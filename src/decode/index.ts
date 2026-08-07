#!/usr/bin/env node
import { types, Node } from "@babel/core";
import generate from "@babel/generator";
import { parse } from "@babel/parser";
import traverse from "@babel/traverse";
import fs from "fs";
import { EOL } from "os";
import path from "path";
import prettier from "prettier";
import readline from "readline";
import { config } from "../config";
import { MainConfig } from "../config/main_config";
import { MapContext } from "../context/map_context";
import { scanfCodeDirs, scanfCodeFiles, resolveLibDirs, scanfLibMod } from "../scanf";
import { deleteModMethods, getUnknownDepNames, importMods } from "../util/ast";
import {
  writeVersion,
  getVersionMethodName,
  getVersionLogPrefix
} from "../util/version";
import { ObjectMethod, Identifier } from "@babel/types";
import { createLogger } from "../util/logger";
import { getParentRootDir } from "../util/parent_path";

const logger = createLogger("decode");

/** 重名依赖冲突记录 */
interface DepConflict {
  inPath: string;
  depName: string;
  candidates: string[];
}

(async function decoding(config: MainConfig) {
  const targetDirs = scanfCodeDirs(config.baseDir, config.target);

  logger.step("扫描目录");
  logger.info(`目标目录: ${targetDirs.join(", ")}`);

  const codeFiles = scanfCodeFiles(targetDirs, config.decode.file);
  logger.info(`找到 ${codeFiles.length} 个编码文件 (${config.decode.file})`);

  // 解析 libs 目录（用于补充缺失依赖）
  const rootDir = getParentRootDir() || config.baseDir;
  const libDirs = resolveLibDirs(config.libs, config.baseDir, rootDir);
  if (libDirs.length) {
    logger.info(`依赖库搜索目录: ${libDirs.join(", ")}`);
  }

  const conflicts: DepConflict[] = [];

  for (let i = 0; i < codeFiles.length; i++) {
    const inPath = codeFiles[i];
    const outPath = path.join(path.dirname(inPath), config.decode.output);
    const settingDir = path.join(path.dirname(inPath), config.settingDir);

    logger.step(`解码处理 [${i + 1}/${codeFiles.length}]`);
    logger.info(`源文件: ${inPath}`);

    await decoding$0(inPath, outPath, config, settingDir, libDirs, conflicts);

    logger.info(`输出: ${outPath}`);
  }

  // 批处理结束后处理重名冲突
  if (conflicts.length) {
    logger.step("处理重名依赖冲突");
    const conflictFiles = await resolveConflicts(conflicts, config);
    // 重新 decode 已解决冲突的文件
    for (const inPath of conflictFiles) {
      const outPath = path.join(path.dirname(inPath), config.decode.output);
      const settingDir = path.join(path.dirname(inPath), config.settingDir);
      logger.step(`重新解码: ${inPath}`);
      await decoding$0(inPath, outPath, config, settingDir, libDirs, []);
      logger.info(`输出: ${outPath}`);
    }
  }

  logger.step("完成");
  logger.info(`共处理 ${codeFiles.length} 个文件`);
})(config);

/**
 * 解码
 * @param inPath - 源文件路径
 * @param outPath - 输入文件路径
 * @param config - 配置
 * @param settingDir - setting目录路径
 * @param libDirs - 依赖库搜索目录（绝对路径）
 * @param conflicts - 重名冲突收集列表（传入 null/空数组表示不记录冲突，如重跑时）
 */
async function decoding$0(
  inPath: string,
  outPath: string,
  config: MainConfig,
  settingDir: string,
  libDirs: string[],
  conflicts: DepConflict[]
) {
  const mapContext = MapContext.readFromLocal(settingDir);

  let src = fs.readFileSync(inPath, {
    encoding: "utf-8"
  });
  src = `const ${config.decode.mount} = {${src}};${EOL}module.exports = ${config.decode.mount};`;
  const srcAst = parse(src);
  if (!types.isNode(srcAst)) {
    return;
  }

  // 补充缺失依赖：从 coded.js 提取未知 __{mod} 后缀，在 libs 目录搜索文件
  const supplemented = supplementMissingDeps(
    srcAst,
    mapContext,
    libDirs,
    inPath,
    conflicts
  );
  if (supplemented) {
    // 有补充则先写回 mod.map，确保后续 importMods/deleteModMethods 能用到
    mapContext.writeToLocalDir(settingDir);
  }

  importMods(path.dirname(outPath), srcAst, mapContext, config.encode.useAlias);
  deleteModMethods(srcAst, mapContext);

  // 从onFormReady方法中提取版本日志并移除
  extractAndRemoveVersionLog(srcAst, settingDir);

  let { code: dist } = generate(srcAst, { compact: true });
  dist = dist.replace(/\\u([\d\w]{4})/g, (match, group) => {
    const charCode = parseInt(group, 16);
    return String.fromCharCode(charCode);
  });
  dist = await prettier.format(dist, {
    parser: "babel",
    trailingComma: "none"
  });
  fs.writeFileSync(outPath, dist, "utf-8");
}

/**
 * 补充缺失依赖到 mapContext
 * 扫描 coded.js 中未知的 __{mod} 后缀，在 libs 目录搜索对应文件并补充到 mod.map。
 * @returns 是否有补充（需要写回 mod.map）
 */
function supplementMissingDeps(
  srcAst: Node,
  mapContext: MapContext,
  libDirs: string[],
  inPath: string,
  conflicts: DepConflict[]
): boolean {
  if (!libDirs.length) {
    return false;
  }

  // 收集已知依赖名（所有 mod 名 + 所有 dependency 名）
  const knownDeps = new Set<string>();
  mapContext.getModNames().forEach((modName) => {
    knownDeps.add(modName);
    mapContext.getDependencyNameByMod(modName).forEach((dep) => knownDeps.add(dep));
  });

  const unknownDeps = getUnknownDepNames(srcAst, knownDeps);
  if (!unknownDeps.length) {
    return false;
  }

  let supplemented = false;
  unknownDeps.forEach((depName) => {
    const candidates = scanfLibMod(libDirs, depName);
    if (candidates.length === 0) {
      logger.warn(`未找到依赖文件: ${depName}（在 libs 目录中无匹配）`);
    } else if (candidates.length === 1) {
      mapContext.appendMissingDep(depName, candidates[0]);
      logger.info(`补充依赖: ${depName} -> ${candidates[0]}`);
      supplemented = true;
    } else {
      conflicts.push({ inPath, depName, candidates });
      logger.warn(
        `依赖重名: ${depName}，找到 ${candidates.length} 个候选，稍后处理`
      );
    }
  });
  return supplemented;
}

/**
 * 交互式解决重名依赖冲突
 * 逐个让用户选择依赖文件，更新对应 mod.map。
 * @returns 需要重新 decode 的文件路径列表（去重）
 */
async function resolveConflicts(
  conflicts: DepConflict[],
  config: MainConfig
): Promise<string[]> {
  // 按 inPath 分组
  const byFile = new Map<string, DepConflict[]>();
  conflicts.forEach((c) => {
    if (!byFile.has(c.inPath)) {
      byFile.set(c.inPath, []);
    }
    byFile.get(c.inPath)!.push(c);
  });

  const redecodeFiles: string[] = [];
  for (const [inPath, fileConflicts] of byFile) {
    const settingDir = path.join(path.dirname(inPath), config.settingDir);
    const mapContext = MapContext.readFromLocal(settingDir);
    let resolved = false;

    logger.info(`文件: ${inPath}`);
    for (const { depName, candidates } of fileConflicts) {
      const choice = await askConflictChoice(depName, candidates);
      if (choice === null) {
        // 用户跳过
        logger.warn(`跳过依赖: ${depName}`);
        continue;
      }
      mapContext.appendMissingDep(depName, candidates[choice]);
      logger.info(`已选择: ${depName} -> ${candidates[choice]}`);
      resolved = true;
    }

    if (resolved) {
      mapContext.writeToLocalDir(settingDir);
      if (!redecodeFiles.includes(inPath)) {
        redecodeFiles.push(inPath);
      }
    }
  }
  return redecodeFiles;
}

/**
 * 交互式询问用户选择重名依赖的候选文件
 * @returns 选择的候选序号，null 表示跳过
 */
function askConflictChoice(
  depName: string,
  candidates: string[]
): Promise<number | null> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    console.log(`\n  依赖 "${depName}" 找到 ${candidates.length} 个候选文件:`);
    candidates.forEach((c, i) => {
      console.log(`    [${i + 1}] ${c}`);
    });
    console.log(`    [s] 跳过该依赖`);
    rl.question(`  请选择 [1-${candidates.length} / s]: `, (answer) => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();
      if (trimmed === "s") {
        resolve(null);
        return;
      }
      const num = parseInt(trimmed, 10);
      if (isNaN(num) || num < 1 || num > candidates.length) {
        logger.warn(`无效输入，已跳过: ${depName}`);
        resolve(null);
        return;
      }
      resolve(num - 1);
    });
  });
}

/**
 * 从onFormReady方法中提取版本日志并移除，将版本号写入version文件
 * @param srcAst - 源码AST
 * @param settingDir - setting目录路径
 */
function extractAndRemoveVersionLog(srcAst: Node, settingDir: string): void {
  const methodName = getVersionMethodName();
  const logPrefix = getVersionLogPrefix();
  let extractedVersion: string | null = null;

  traverse(srcAst as Node, {
    ObjectMethod(path) {
      if (!types.isIdentifier(path.node.key)) {
        return;
      }
      if (path.node.key.name !== methodName) {
        return;
      }
      // 遍历方法体，查找并移除版本日志
      const body = path.node.body.body;
      for (let i = 0; i < body.length; i++) {
        const stmt = body[i];
        if (
          types.isExpressionStatement(stmt) &&
          types.isCallExpression(stmt.expression) &&
          types.isMemberExpression(stmt.expression.callee) &&
          types.isIdentifier(stmt.expression.callee.object) &&
          stmt.expression.callee.object.name === "console" &&
          types.isIdentifier(stmt.expression.callee.property) &&
          stmt.expression.callee.property.name === "log"
        ) {
          const args = stmt.expression.arguments;
          if (
            args.length === 1 &&
            types.isStringLiteral(args[0]) &&
            args[0].value.startsWith(logPrefix)
          ) {
            // 提取版本号
            extractedVersion = args[0].value.replace(logPrefix, "").trim();
            // 移除版本日志行
            body.splice(i, 1);
            break;
          }
        }
      }
      // 如果onFormReady方法体为空（仅包含版本日志），则删除整个方法
      if (body.length === 0) {
        path.remove();
      }
    }
  });

  // 将版本号写入version文件
  if (extractedVersion) {
    writeVersion(settingDir, extractedVersion);
  }
}
