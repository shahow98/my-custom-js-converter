#!/usr/bin/env node
import { types, Node } from "@babel/core";
import generate from "@babel/generator";
import { parse } from "@babel/parser";
import traverse from "@babel/traverse";
import fs from "fs";
import { EOL } from "os";
import path from "path";
import prettier from "prettier";
import { config } from "../config";
import { MainConfig } from "../config/main_config";
import { MapContext } from "../context/map_context";
import { scanfCodeDirs, scanfCodeFiles } from "../scanf";
import { deleteModMethods, importMods } from "../util/ast";
import {
  writeVersion,
  getVersionMethodName,
  getVersionLogPrefix
} from "../util/version";
import { ObjectMethod, Identifier } from "@babel/types";

(async function decoding(config: MainConfig) {
  const targetDirs = scanfCodeDirs(config.baseDir, config.target);
  console.log("scanf dirs => ");
  console.log(targetDirs);
  const codeFiles = scanfCodeFiles(targetDirs, config.decode.file);
  for (const inPath of codeFiles) {
    console.log(`scanf file => ${inPath}`);
    const outPath = path.join(path.dirname(inPath), config.decode.output);
    const settingDir = path.join(path.dirname(inPath), config.settingDir);
    await decoding$0(inPath, outPath, config, settingDir);
    console.log(`output => ${outPath}`);
  }
})(config);

/**
 * 解码
 * @param inPath - 源文件路径
 * @param outPath - 输入文件路径
 * @param config - 配置
 * @param settingDir - setting目录路径
 */
async function decoding$0(
  inPath: string,
  outPath: string,
  config: MainConfig,
  settingDir: string
) {
  const mapContext = MapContext.readFromLocal(
    path.join(path.dirname(inPath), config.settingDir)
  );
  let src = fs.readFileSync(inPath, {
    encoding: "utf-8"
  });
  src = `const ${config.decode.mount} = {${src}};${EOL}module.exports = ${config.decode.mount};`;
  const srcAst = parse(src);
  if (!types.isNode(srcAst)) {
    return;
  }
  importMods(path.dirname(outPath), srcAst, mapContext);
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
