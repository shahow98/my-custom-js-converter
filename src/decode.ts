import fs from "fs";
import path from "path";
import prettier from "prettier";
import { parse } from "@babel/parser";
import traverse from "@babel/traverse";
import generate from "@babel/generator";
import { Identifier, MemberExpression } from "@babel/types";
import { Node, types } from "@babel/core";
import { scanfCodeDirs, scanfCodeFiles } from "./scanf";
import config from "./config";
import { Mod, SubConfig } from "./config/sub_config";
const TARGET_DIR = scanfCodeDirs(config.baseDir, config.target);
const DECODE_FILE = config.decode.file;
const OUTPUT_FILE = config.decode.output;
const MOUNT = config.decode.mount;
const WORK_DIR = config.workDir;
const CUSTOM_CONFIG = config.customConfig;

(function decoding(targetDirs: string[] = TARGET_DIR) {
  console.log("scanf dirs => ");
  console.log(targetDirs);
  const codeFiles = scanfCodeFiles(targetDirs, DECODE_FILE);
  codeFiles.forEach((file) => {
    console.log(`scanf file => ${file}`);
    const outPath = path.join(path.dirname(file), OUTPUT_FILE);
    decoding$0(file, outPath);
    console.log(`output => ${outPath}`);
  });
})();

/**
 * 解码
 * @param inPath - 源文件路径
 * @param outPath - 输入文件路径
 * @param mount - 方法挂载点
 */
function decoding$0(inPath: string, outPath: string, mount: string = MOUNT) {
  const customConfig = loadCustomConfig(path.dirname(inPath));
  let src = fs.readFileSync(inPath, {
    encoding: "utf-8"
  });
  src = `const ${mount} = {${src}};`;
  const srcAst = parse(src);
  importMods(path.dirname(outPath), customConfig.mod, srcAst);
  deleteModMethods(customConfig.mod, srcAst);
  let { code: dist } = generate(srcAst);
  dist = dist.replace(/},\n\n/g, "},\n");
  dist = prettier.format(dist, {
    parser: "babel",
    trailingComma: "none"
  });
  fs.writeFileSync(outPath, dist, "utf-8");
}

function importMods(
  outDir: string,
  mods: Mod[],
  srcAst?: Node | Node[]
) {
  const importMods = mods.map((mod) => {
    const requireFrom = path
      .relative(outDir, mod.path.replace(/index\.js$/, ""))
      .replace(/[\\]+/g, "/");
    const variableDeclarator = types.variableDeclarator(
      types.identifier(mod.name),
      types.callExpression(types.identifier("require"), [
        types.stringLiteral(requireFrom)
      ])
    );
    return types.variableDeclaration("const", [variableDeclarator]);
  });

  traverse(srcAst, {
    Program(path) {
      path.node.body.unshift(...importMods);
    }
  });
}

/**
 * 去除第三方模块方法
 * @param srcAst - 源码AST
 */
function deleteModMethods(mods: Mod[], srcAst?: Node | Node[]) {
  const modNames = mods.map((m) => m.name);
  traverse(srcAst, {
    ObjectMethod(path) {
      if (!types.isIdentifier(path.node.key)) {
        return;
      }
      const methodName = (path.node.key as Identifier).name;
      modNames
        .filter((name) => methodName.lastIndexOf(`__${name}`) !== -1)
        .forEach(() => {
          path.remove();
        });
    },
    Identifier(path) {
      const id = path.node.name;
      modNames
        .filter((name) => id.lastIndexOf(`__${name}`) !== -1)
        .forEach((name) => {
          path.node.name = id.replace(`__${name}`, "");

          const expression = path.findParent((path) =>
            path.isMemberExpression()
          ) as MemberExpression | null;
          if (!types.isThisExpression(expression?.object)) {
            return;
          }
          expression!.object = types.identifier(name);
        });
    }
  });
}

function loadCustomConfig(
  inPath: string,
  workDir: string = WORK_DIR,
  config: string = CUSTOM_CONFIG
): SubConfig {
  const configPath = path.join(inPath, workDir, config);
  let configObj: SubConfig = {
    mod: [],
  };
  try {
    fs.accessSync(configPath, fs.constants.F_OK);
    console.log(`load custom config => ${configPath}`);
    const data = fs.readFileSync(configPath, { encoding: "utf-8" });
    configObj = JSON.parse(data) as SubConfig;
    configObj.mod.forEach((m) => {
      m.name = m.name.replace("\\", "\\\\");
    });
  } catch (err) {
    console.log(`not found custom config => ${configPath}`);
  }
  return configObj;
}
