import fs from "fs";
import { parse } from "@babel/parser";
import traverse, { NodePath } from "@babel/traverse";
import generate from "@babel/generator";
import { Node, types } from "@babel/core";
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
import { scanfCodeFiles, scanfCodeDirs, scanfRequieMod } from "../scanf";
import { Mod } from "../config/map_config";
import { MapContext } from "../context/map_context";
import { relative } from "path";
import { AstPath } from "prettier";

type AstType = Node | Node[] | null | undefined;

export function parseSrcAst(srcPath?: string): AstType {
  if (!srcPath) {
    return;
  }
  const src = fs.readFileSync(srcPath, {
    encoding: "utf-8"
  });
  return parse(src);
}

export function outputObjectMethods(outPath: string, methods: ObjectMethod[]) {
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
}

/**
 * 获取所有依赖第三方模块路径(仅导入program下一级的require)
 * val xx = require('path') => [xx, absolute path]
 * @param baseDir - 源码所在文件夹目录
 * @param srcAst - 源码AST
 * @param ignoreMod - 忽略模块
 * @returns
 */
export function getRequireModPaths(
  baseDir: string,
  srcAst: AstType,
  ignoreMod?: string[]
): Map<string, string> {
  const modPathByName = new Map<string, string>();
  traverse(srcAst, {
    Program(path) {
      path.node.body.filter(item => types.isVariableDeclaration(item)).flatMap(item => (item as VariableDeclaration).declarations)
      .filter(item => {
        if(types.isCallExpression(item.init) && types.isIdentifier(item.init.callee)) {
          if(item.init.callee.name === "require") {
            if(types.isIdentifier(item.id)) {
              if(ignoreMod?.includes(item.id.name)) {
                console.log(`ignore module => ${item.id.name}`);
              } else {
                return true;
              }
            }
          }
        }
        return false;
      }).forEach(item => {
        const args = ((item.init as CallExpression).arguments);
        if(args.length) {
          const modName = (item.id as Identifier).name;
          const modPath = (args[0] as StringLiteral).value;
          modPathByName.set(modName, scanfRequieMod(baseDir, modPath));
        }
      });
    }
  });
  return modPathByName;
}

/**
 * 获取源码中引用的第三方模块方法名
 * @param mod - 依赖模块
 * @param srcAst - 源码AST
 * @returns
 */
export function getRequireMethodNames(
  srcAst: AstType,
  mod: string[]
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
 * 获取方法名
 * @param methods
 * @returns
 */
export function getObjectMethodNames(methods: ObjectMethod[]): string[] {
  return methods
    .filter((node) => types.isIdentifier(node.key))
    .map((node) => node.key as Identifier)
    .map((key) => key.name);
}

/**
 * 获取源码入口对象所有方法
 * @param srcAst - 源码Ast
 * @param entry - 入口对象
 * @param methodNames - 需要获取方法的方法名
 * @returns
 */
export function getObjectMethodsByEntryAndMethodNames(
  srcAst: AstType,
  entry: string,
  methodNames?: string[]
): ObjectMethod[] {
  const methods: ObjectMethod[] = [];
  traverse(srcAst, {
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
                const objectMethods = init.properties
                  .filter((property) => types.isObjectMethod(property))
                  .filter((property) => {
                    if (types.isIdentifier((property as ObjectMethod).key)) {
                      const objectMethodKey = (property as ObjectMethod)
                        .key as Identifier;
                      if (
                        !methodNames ||
                        methodNames.includes(objectMethodKey.name)
                      ) {
                        return true;
                      }
                    }
                    return false;
                  }) as ObjectMethod[];
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
 * 获取方法和内部调用的方法(仅包含自身模块方法,不包含第三方依赖)
 * @param srcAst
 * @param entry
 * @param methods
 */
export function getObjectMehtodsByMehtodNamesAndInsideOwnMethods(
  srcAst: AstType,
  entry: string,
  methodNames: string[]
): ObjectMethod[] {
  if (!methodNames.length) {
    return [];
  }

  // console.log(`methodNames => ${methodNames}`);
  const allMethodNames = getObjectMethodNames(
    getObjectMethodsByEntryAndMethodNames(srcAst, entry)
  );
  let insideMethodNames = getInsideOwnMethodNames(srcAst, entry, methodNames);
  insideMethodNames = insideMethodNames.filter((name) =>
    allMethodNames.includes(name)
  );
  // console.log(`insideMethodNames => ${insideMethodNames}`);
  return getObjectMethodsByEntryAndMethodNames(srcAst, entry, [
    ...methodNames,
    ...insideMethodNames
  ]);
}

function getInsideOwnMethodNames(
  srcAst: AstType,
  entry: string,
  methodNames: string[],
  allMethodNameSet: Set<string> = new Set<string>()
): string[] {
  if (!methodNames.length) {
    return [];
  }

  methodNames.forEach((name) => allMethodNameSet.add(name));

  const insideMethodNameSet = new Set<string>();
  traverse(srcAst, {
    MemberExpression(path) {
      if (
        !(
          (types.isIdentifier(path.node.object) &&
            path.node.object.name === entry) ||
          types.isThisExpression(path.node.object)
        )
      ) {
        return;
      }

      const objectMethodNode = path.findParent((path) =>
        types.isObjectMethod(path)
      ) as NodePath<ObjectMethod> | null;
      if (!types.isIdentifier(objectMethodNode?.node.key)) {
        return;
      }

      const parentMethodKey = objectMethodNode?.node.key;
      if (parentMethodKey && methodNames.includes(parentMethodKey.name)) {
        if (types.isIdentifier(path.node.property)) {
          const propertyId = path.node.property;
          if (!allMethodNameSet.has(propertyId.name)) {
            insideMethodNameSet.add(propertyId.name);
          }
        }
      }
    }
  });
  const insideMethodNames = [...insideMethodNameSet];
  insideMethodNames.push(
    ...getInsideOwnMethodNames(
      srcAst,
      entry,
      insideMethodNames,
      allMethodNameSet
    )
  );
  return insideMethodNames;
}

export function modifyObjectMethods(
  srcAst: AstType,
  entry: string,
  mod: Mod,
  methods: ObjectMethod[],
  root: boolean = false
) {
  const deps = Object.keys(mod.dependencies);
  const methodNames = getObjectMethodNames(methods);

  traverse(srcAst, {
    MemberExpression(path) {
      if (
        types.isThisExpression(path.node.object) &&
        types.isIdentifier(path.node.property)
      ) {
        if (root) {
          return;
        }
        if (methodNames.includes(path.node.property.name)) {
          path.node.property.name = `${path.node.property.name}__${entry}`;
        }
      }

      if (types.isIdentifier(path.node.object)) {
        const depName = path.node.object.name;
        if (root && depName === entry) {
          path.node.object = types.thisExpression();
        } else if (deps.includes(depName)) {
          path.node.object = types.thisExpression();
          if (types.isIdentifier(path.node.property)) {
            path.node.property.name = `${path.node.property.name}__${depName}`;
          }
        }
      }
    },
    ObjectMethod(path) {
      if (root) {
        return;
      }
      if (types.isIdentifier(path.node.key)) {
        path.node.key.name = `${path.node.key.name}__${entry}`;
      }
      types.addComment(
        path.node.body,
        "inner",
        "auto-generated: Please do not modify the."
      );
    }
  });
}

export function getDependentMethodNames(
  srcAst: AstType,
  methodNames: string[],
  depNames: string[]
) {
  const methodNamesByDepName = new Map<string, string[]>();
  traverse(srcAst, {
    MemberExpression(path) {
      const objectMethodNode = path.findParent((path) =>
        types.isObjectMethod(path)
      ) as NodePath<ObjectMethod> | null;
      if (!types.isIdentifier(objectMethodNode?.node.key)) {
        return;
      }

      if (!methodNames.includes(objectMethodNode!.node.key.name)) {
        return;
      }

      if (
        !(
          types.isIdentifier(path.node.object) &&
          types.isIdentifier(path.node.property)
        )
      ) {
        return;
      }

      if (depNames.includes(path.node.object.name)) {
        const depName = path.node.object.name;
        if (!methodNamesByDepName.has(depName)) {
          methodNamesByDepName.set(depName, []);
        }
        methodNamesByDepName.get(depName)?.push(path.node.property.name);
      }
    }
  });
  return methodNamesByDepName;
}

/**
 * 生成导入语句
 * const mod = require($modPath);
 * @param outDir
 * @param srcAst
 * @param mapContext
 */
export function importMods(
  outDir: string,
  srcAst: AstType,
  mapContext: MapContext
) {
  const depNames = mapContext.getDependencyNameByMod("self");
  const importMods = depNames.map(name => {
    const srcPath = mapContext.getSrcPathByMod(name)!;
    const requireFrom = relative(
      outDir,
      srcPath.replace(/(index)?\.js$/, "")
    ).replace(/[\\]+/g, "/");
    const variableDeclarator = types.variableDeclarator(
      types.identifier(name),
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
export function deleteModMethods(srcAst: AstType, mapContext: MapContext) {
  const deps = new Set<string>();
  mapContext
    .getModNames()
    .flatMap((name) => Object.keys(mapContext.getMod(name)?.dependencies!))
    .forEach((dep) => deps.add(dep));
  traverse(srcAst, {
    ObjectMethod(path) {
      if (!types.isIdentifier(path.node.key)) {
        return;
      }
      const methodName = path.node.key.name;
      const split = methodName.split("__");
      if(split.length < 2) {
        return;
      }
      const depName = split.length ? split[split.length - 1] : "";
      deps.has(depName) && path.remove();
    }
  });
  traverse(srcAst, {
    MemberExpression(path) {
      if (!types.isIdentifier(path.node.property)) {
        return;
      }
      const methodName = path.node.property.name;
      const split = methodName.split("__");
      if(split.length < 2) {
        return;
      }
      const depName = split[split.length - 1];
      if (deps.has(depName)) {
        path.node.property.name = methodName.replace(`__${depName}`, "");

        if (types.isThisExpression(path.node.object)) {
          path.node.object = types.identifier(depName);
        }
      }
    }
  });
}
