import fs from "fs";
import path from "path";
import { parse } from "@babel/parser";
import traverse, { NodePath } from "@babel/traverse";
import generate from "@babel/generator";
import { Node, types } from "@babel/core";
import { scanfCodeFiles, scanfCodeDirs, scanfRequieMod } from "./scanf";
import config, { Config } from "./config";
import {
  CallExpression,
  Identifier,
  MemberExpression,
  ObjectExpression,
  ObjectMethod,
  StringLiteral,
  VariableDeclarator,
  VariableDeclaration
} from "@babel/types";
const TARGET_DIR = scanfCodeDirs(config.baseDir, config.target);
const ENCODE_FILE = config.encode.file;
const OUTPUT_FILE = config.encode.output;
const ENTRY = config.encode.entry;
const IGNORE_MOD = config.encode.ignoreMod;
const CUSTOM_CONFIG = config.customConfig;

(function encoding(targetDirs: string[] = TARGET_DIR) {
  console.log("scanf dirs => ");
  console.log(targetDirs);
  const codeFiles = scanfCodeFiles(targetDirs, ENCODE_FILE);
  codeFiles.forEach((file) => {
    console.log(`scanf file => ${file}`);
    const outPath = path.join(path.dirname(file), OUTPUT_FILE);
    encoding$0(file, outPath);
    console.log(`output => ${outPath}`);
  });
})();

/**
 * 编码
 * @param inPath - 源文件路径
 * @param outPath - 输入文件路径
 */
function encoding$0(inPath: string, outPath: string) {
  const src = fs.readFileSync(inPath, {
    encoding: "utf-8"
  });
  const srcAst = parse(src);
  const methods: ObjectMethod[] = [];
  const importModPathByName = getImportModPaths(path.dirname(inPath), srcAst);
  const importMethodNamesByMod = getImportMethodNames(
    [...importModPathByName.keys()],
    srcAst
  );
  const importMethods = getImportMethods(
    importModPathByName,
    importMethodNamesByMod
  );

  const customMethodNames = getSrcMethodNames(ENTRY, srcAst);
  modifyCallObjectAndMethodNames(
    customMethodNames,
    [...importModPathByName.keys()],
    srcAst
  );
  const customMethods = getMethods(ENTRY, srcAst);

  methods.push(...customMethods, ...importMethods);
  const dist = methods
    .map((m) => {
      if (m.leadingComments?.length) {
        m.leadingComments = undefined;
      }
      return m;
    })
    .map((m) => generate(m))
    .map((m) => m.code)
    .join(",\n");

  fs.writeFileSync(outPath, dist, "utf-8");
  refreshCustomConfig(importModPathByName, path.dirname(inPath));
}

/**
 * 获取所有依赖方法
 * @param modPathByName - 模块路径
 * @param methodNamesByMod - 依赖模块方法名
 * @returns
 */
function getImportMethods(
  modPathByName: Map<string, string>,
  methodNamesByMod: Map<string, string[]>
): ObjectMethod[] {
  return [...modPathByName.entries()].flatMap(([name, modPath]) => {
    console.log(`import => ${name}`);
    const mod = fs.readFileSync(modPath, { encoding: "utf-8" });
    const modAst = parse(mod);
    const modMethods = getMethods(name, modAst);
    if (!methodNamesByMod.has(name)) {
      return [];
    }
    const modMethodNames = modMethods.map((m) => (m.key as Identifier).name);
    // console.log(`mod methods => ${modMethodNames}`);
    const useMethodNames = methodNamesByMod.get(name) as string[];
    // console.log(`use methods => ${useMethodNames}`);
    const inlineMethodNames = getInlineThisMethodNames(
      modMethodNames,
      useMethodNames,
      modAst
    );
    // console.log(`inline methods => ${inlineMethodNames}`);
    let mergeMethodNames = [
      ...new Set([...useMethodNames, ...inlineMethodNames])
    ];
    modifyModMethods(name, mergeMethodNames, modAst);
    // console.log(generate(modAst).code);
    const mergeMethods: ObjectMethod[] = mergeMethodNames
      .map((name) => {
        return modMethods.find(
          (m) =>
            types.isIdentifier(m.key) && (m.key as Identifier).name === name
        );
      })
      .filter((m) => m) as ObjectMethod[];
    // console.log(`inline methods size => ${inlineMethodNames.length}`);
    // console.log(`import methods size => ${mergeMethods.length}`);
    return mergeMethods.map((m) => {
      if(types.isIdentifier(m.key)) {
        const key = m.key as Identifier;
        key.name = `${key.name}__${name}`;
      }
      
      m.body = types.addComment(
        m.body,
        "inner",
        "auto-generated: Please do not modify the."
      );
      return m;
    });
  });
}

/**
 * 获取调用的方法内的this方法
 * @param modMethodNames - 模块所有方法名
 * @param useMethodNames - 调用的方法名
 * @param modAst - 模块AST
 * @returns
 */
function getInlineThisMethodNames(
  modMethodNames: string[],
  useMethodNames: string[],
  modAst?: Node | Node[]
): string[] {
  if (!useMethodNames.length) {
    return [];
  }
  const thisMethodNames = new Set<string>();
  traverse(modAst, {
    ThisExpression(path) {
      const objectMethod = path.findParent((path) =>
        path.isObjectMethod()
      ) as NodePath<ObjectMethod> | null;
      const id = objectMethod?.node.key;
      if (!types.isIdentifier(id)) {
        return;
      }
      if (useMethodNames.includes(id.name)) {
        const memberExpression = path.findParent((path) =>
          path.isMemberExpression()
        ) as NodePath<MemberExpression> | null;
        const property = memberExpression?.node.property;
        if (!types.isIdentifier(property)) {
          return;
        }
        if (modMethodNames.includes(property.name)) {
          thisMethodNames.add(property.name);
        }
      }
    }
  });
  return [
    ...thisMethodNames,
    ...getInlineThisMethodNames(modMethodNames, [...thisMethodNames], modAst)
  ];
}

/**
 * 获取所有依赖第三方模块路径
 * @param curDir - 源码所在文件夹目录
 * @param srcAst - 源码AST
 * @param ignoreMod - 忽略模块
 * @returns
 */
function getImportModPaths(
  curDir: string,
  srcAst?: Node | Node[],
  ignoreMod: string[] = IGNORE_MOD
): Map<string, string> {
  const modPathByName = new Map<string, string>();
  traverse(srcAst, {
    Identifier(nodePath) {
      if (nodePath.node.name === "require") {
        const callExpression = nodePath.findParent((path) =>
          path.isCallExpression()
        ) as NodePath<CallExpression> | null;
        const args = callExpression?.node.arguments as Node[] | null;
        if (args?.length != 1) {
          return;
        }
        let modPath = (args[0] as StringLiteral).value;
        modPath = scanfRequieMod(curDir, modPath);
        const variableDeclarator = nodePath.findParent((path) =>
          path.isVariableDeclarator()
        ) as NodePath<VariableDeclarator>;
        if (!variableDeclarator) {
          return;
        }
        const id = variableDeclarator.node.id as Identifier;
        const ignore = ignoreMod.includes(id.name);
        ignore && console.log(`ignore => ${id.name}`);
        !ignore && modPathByName.set(id.name, modPath);
      }
    }
  });
  return modPathByName;
}

/**
 * 获取源码中第三方模块方法名
 * @param mod - 依赖模块
 * @param srcAst - 源码AST
 * @returns
 */
function getImportMethodNames(
  mod: string[],
  srcAst?: Node | Node[]
): Map<string, string[]> {
  const methodsByMod = new Map<string, string[]>();
  traverse(srcAst, {
    MemberExpression(path) {
      const invokeObj = path.node.object;
      if (!types.isIdentifier(invokeObj)) {
        return;
      }
      const invokeMethod = path.node.property;
      if (!types.isIdentifier(invokeMethod)) {
        return;
      }
      const key = invokeObj.name;
      if (!mod.includes(key)) {
        return;
      }
      let methods: string[] = [];
      if (methodsByMod.has(key)) {
        methods = methodsByMod.get(key) as string[];
      }
      !methods.includes(invokeMethod.name) && methods.push(invokeMethod.name);
      methodsByMod.set(key, methods);
    }
  });
  return methodsByMod;
}

/**
 * 获取源码入口对象所有方法名
 * @param entry - 入口对象
 * @param srcAst - 源码Ast
 * @returns
 */
function getSrcMethodNames(entry: string, srcAst?: Node | Node[]): string[] {
  return getMethods(entry, srcAst)
    .filter((node) => types.isIdentifier(node.key))
    .map((node) => node.key as Identifier)
    .map((key) => key.name);
}

/**
 * 获取源码入口对象所有方法
 * todo: 重复获取方法
 * @param entry - 入口对象
 * @param ast - AST
 * @returns
 */
function getMethods(entry: string, ast?: Node | Node[]): ObjectMethod[] {
  const methods: ObjectMethod[] = [];
  traverse(ast, {
    Program(path) {
      path.node.body.forEach((statement) => {
        if (types.isVariableDeclaration(statement)) {
          const variableDeclaration = statement as VariableDeclaration;
          variableDeclaration.declarations
            .filter((declaration) => {
              if (types.isIdentifier(declaration.id)) {
                const id = declaration.id as Identifier;
                if (id.name === entry) {
                  return true;
                }
              }
              return false;
            })
            .forEach((declaration) => {
              if (types.isObjectExpression(declaration.init)) {
                const init = declaration.init as ObjectExpression;
                const objectMethods = init.properties.filter((property) =>
                  types.isObjectMethod(property)
                ) as ObjectMethod[];
                methods.push(...objectMethods);
              }
            });
        }
      });
    }
  });
  return methods;
}

/**
 * 修改源码第三方模块调用方法名和指向
 * e.g. from util.func() to this.func__util()
 * @param methodNames - 需调用方法
 * @param importMod - 导入模块
 * @param srcAst - AST
 */
function modifyCallObjectAndMethodNames(
  methodNames: string[],
  importMod: string[],
  srcAst?: Node | Node[]
) {
  traverse(srcAst, {
    MemberExpression(path) {
      const objectMethod = path.findParent((path) =>
        path.isObjectMethod()
      ) as NodePath<ObjectMethod> | null;
      if (!types.isIdentifier(objectMethod?.node.key)) {
        return;
      }
      if (!methodNames.includes((objectMethod?.node.key as Identifier).name)) {
        return;
      }
      if (types.isThisExpression(path.node.object)) {
        return;
      }
      if (!types.isIdentifier(path.node.object)) {
        return;
      }
      const name = (path.node.object as Identifier).name;
      if (!importMod.includes(name)) {
        return;
      }
      path.node.object = types.thisExpression();
      if (!types.isIdentifier(path.node.property)) {
        return;
      }
      const property = path.node.property as Identifier;
      property.name = `${property.name}__${name}`;
    }
  });
}

/**
 * 修改导入模块方法名
 * e.g. from util.func() to this.func__util()
 * @param mod - 模块名
 * @param methodNames - 需调用方法
 * @param modAst - AST
 */
function modifyModMethods(
  mod: string,
  methodNames: string[],
  modAst?: Node | Node[]
) {
  traverse(modAst, {
    MemberExpression(path) {
      if (types.isIdentifier(path.node.property)) {
        const property = path.node.property as Identifier;
        if (methodNames.includes(property.name)) {
          if (
            types.isIdentifier(path.node.object) ||
            types.isThisExpression(path.node.object)
          ) {
            property.name = `${property.name}__${mod}`;
          }
        }
      }
    }
  });
}

function refreshCustomConfig(
  modPathByName: Map<string, string>,
  inPath: string,
  config: string = CUSTOM_CONFIG
) {
  const configPath = path.join(inPath, config);
  let configObj: Config.SubConfig = {
    mod: [],
    version: ""
  };
  try {
    fs.accessSync(configPath, fs.constants.F_OK);
    const data = fs.readFileSync(configPath, { encoding: "utf-8" });
    configObj = JSON.parse(data) as Config.SubConfig;
  } catch (err) {
    console.log(`not found custom config => ${configPath}`);
  }
  configObj.mod = [...modPathByName.entries()].map(
    ([key, value]) => new Config.Mod(key, value)
  );
  fs.writeFileSync(configPath, JSON.stringify(configObj, null, 4), "utf-8");
}
