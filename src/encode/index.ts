#!/usr/bin/env node
import path from "path";
import { scanfCodeFiles, scanfCodeDirs } from "../scanf";
import { config } from "../config";
import { ObjectMethod, Identifier } from "@babel/types";
import { MainConfig } from "../config/main_config";
import { MapContext } from "../context/map_context";
import {
  getObjectMethodsByEntryAndMethodNames,
  parseSrcAst,
  getObjectMehtodsByMehtodNamesAndInsideOwnMethods,
  outputObjectMethods,
  modifyObjectMethods,
  getInlinedModMethodNames,
  getRequireModPaths
} from "../util/ast";
import {
  readOrCreateVersion,
  incrementVersion,
  versionLogStatement,
  getVersionMethodName
} from "../util/version";
import { types } from "@babel/core";
import traverse from "@babel/traverse";
import { Node } from "@babel/core";
import { getParentRootDir } from "../util/parent_path";
import { createLogger } from "../util/logger";

const logger = createLogger("encode");

(function encoding(config: MainConfig) {
  const encodeConfig = config.encode;
  const targetDirs = scanfCodeDirs(config.baseDir, config.target);

  logger.step("扫描目录");
  logger.info(`目标目录: ${targetDirs.join(", ")}`);

  const codeFiles = scanfCodeFiles(targetDirs, encodeConfig.file);
  logger.info(`找到 ${codeFiles.length} 个入口文件 (${encodeConfig.file})`);

  let totalMethods = 0;
  codeFiles.forEach((inPath, index) => {
    const workDir = path.dirname(inPath);
    const settingDir = path.join(workDir, config.settingDir);

    logger.step(`编码处理 [${index + 1}/${codeFiles.length}]`);
    logger.info(`源文件: ${inPath}`);

    // 防护检测：源文件 mount 对象内若残留 __mod 后缀方法，说明用户复用了 decode 产物
    // 作为二开源文件。此时禁止通过 require 引入工具方法，只做无依赖编码。
    const guardResult = guardInlinedModMethods(inPath, encodeConfig.entry, config);
    if (guardResult) {
      logger.error(guardResult);
      return;
    }

    const mapContext = new MapContext(
      inPath,
      encodeConfig.entry,
      settingDir,
      true
    );

    const methods = encoding$0(mapContext, encodeConfig.entry);
    totalMethods += methods.length;

    // 读取或创建版本号
    const version = readOrCreateVersion(settingDir);
    // 在onFormReady方法中注入版本日志
    injectVersionLog(methods, version);
    // 将onFormReady和onFormSubmit排到最前面
    reorderMethods(methods);

    const outPath = path.join(workDir, encodeConfig.output);
    outputObjectMethods(outPath, methods);
    logger.info(`方法数: ${methods.length}, 版本: ${version}`);
    logger.info(`输出: ${outPath}`);

    // 版本号递增并写入
    incrementVersion(settingDir);
  });

  logger.step("完成");
  logger.info(`共处理 ${codeFiles.length} 个文件, ${totalMethods} 个方法`);
})(config);

function encoding$0(mapContext: MapContext, entry: string): ObjectMethod[] {
  const modNames = mapContext.getModNames();
  return modNames.flatMap((name) => {
    const srcAst = parseSrcAst(mapContext.getAbsoluteSrcPathByMod(name));
    const srcMethods = [];
    const self = name === "self";
    if (self) {
      srcMethods.push(...getObjectMethodsByEntryAndMethodNames(srcAst, entry));
    } else {
      srcMethods.push(
        ...getObjectMehtodsByMehtodNamesAndInsideOwnMethods(
          srcAst,
          name,
          mapContext.getMethodNamesByMod(name)
        )
      );
    }
    modifyObjectMethods(
      srcAst,
      self ? entry : name,
      mapContext.getMod(name)!,
      srcMethods,
      self
    );
    return srcMethods;
  });
}

/**
 * 在onFormReady方法中注入版本日志，若不存在则创建该方法
 * @param methods - 已编码的方法列表
 * @param version - 当前版本号
 */
function injectVersionLog(methods: ObjectMethod[], version: string): void {
  const methodName = getVersionMethodName();

  // 查找onFormReady方法
  let targetMethod = methods.find(
    (m) => types.isIdentifier(m.key) && m.key.name === methodName
  );

  if (targetMethod) {
    // 在方法体第一行插入版本日志
    const logExpression = types.expressionStatement(
      types.callExpression(
        types.memberExpression(
          types.identifier("console"),
          types.identifier("log")
        ),
        [types.stringLiteral(`__version__: ${version}`)]
      )
    );
    targetMethod.body.body.unshift(logExpression);
  } else {
    // 创建onFormReady方法
    const newMethod = types.objectMethod(
      "method",
      types.identifier(methodName),
      [],
      types.blockStatement([
        types.expressionStatement(
          types.callExpression(
            types.memberExpression(
              types.identifier("console"),
              types.identifier("log")
            ),
            [types.stringLiteral(`__version__: ${version}`)]
          )
        )
      ])
    );
    methods.push(newMethod as ObjectMethod);
  }
}

/**
 * 将onFormReady和onFormSubmit方法排到最前面，不存在则忽略
 * @param methods - 已编码的方法列表（原地排序）
 */
function reorderMethods(methods: ObjectMethod[]): void {
  const priorityNames = ["onFormReady", "onFormSubmit"];
  const priorityMethods: ObjectMethod[] = [];
  const restMethods: ObjectMethod[] = [];

  for (const method of methods) {
    if (
      types.isIdentifier(method.key) &&
      priorityNames.includes(method.key.name)
    ) {
      priorityMethods.push(method);
    } else {
      restMethods.push(method);
    }
  }

  // 按priorityNames的顺序排列优先方法
  priorityMethods.sort((a, b) => {
    const aName = (a.key as Identifier).name;
    const bName = (b.key as Identifier).name;
    return priorityNames.indexOf(aName) - priorityNames.indexOf(bName);
  });

  methods.length = 0;
  methods.push(...priorityMethods, ...restMethods);
}

/**
 * 防护检测：源文件 mount 对象内若残留 `__mod` 后缀方法，且同时通过 require 引入了
 * 工具方法依赖，则禁止编码。
 *
 * 场景：用户把 decode 产物（含未还原的 `validate__util` 等内联方法）复制为 index.js
 * 进行二开，同时又保留了 `const util = require(...)`。此时若继续 encode，会导致
 * 方法重复定义、mod.map 错乱。应提示用户移除 require 引入，只做无依赖编码。
 *
 * @param inPath - 源文件路径
 * @param entry - 入口对象名
 * @param config - 主配置
 * @returns 错误提示字符串（检测到连规时返回，未连规返回 null）
 */
function guardInlinedModMethods(
  inPath: string,
  entry: string,
  config: MainConfig
): string | null {
  const srcAst = parseSrcAst(inPath);
  if (!srcAst) {
    return null;
  }
  const inlinedNames = getInlinedModMethodNames(srcAst, entry);
  if (!inlinedNames.length) {
    return null;
  }
  // 检测是否存在 require 引入的工具方法依赖
  const rootDir = config.encode.useAlias
    ? getParentRootDir() || config.baseDir
    : undefined;
  const requireModPaths = getRequireModPaths(
    path.dirname(inPath),
    srcAst,
    undefined,
    rootDir
  );
  if (!requireModPaths.size) {
    // 有 __mod 方法但无 require 依赖：允许无依赖编码
    return null;
  }
  const depNames = [...requireModPaths.keys()];
  return (
    `检测到源文件 mount 对象内残留工具方法后缀（${inlinedNames.join(
      ", "
    )}），` +
    `同时存在 require 依赖引入（${depNames.join(
      ", "
    )}）。\n` +
    `此场景不允许编码：请移除源文件中的 require 工具方法引入（${depNames
      .map((n) => `const ${n} = require(...)`)
      .join("; ")}），` +
    `仅保留 mount 对象内的 __mod 后缀方法做无依赖编码；` +
    `或将 __mod 后缀方法抽为独立工具文件后再 encode。`
  );
}
