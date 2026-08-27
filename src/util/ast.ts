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
import { EOL } from "os";
import { getParentRootDir } from "./parent_path";
import { config } from "../config";
import { createLogger } from "./logger";

const logger = createLogger("ast");

export type AstType = Node | Node[] | null | undefined;

export function parseSrcAst(srcPath?: string): AstType {
  if (!srcPath) {
    return;
  }
  const src = fs.readFileSync(srcPath, {
    encoding: "utf-8"
  });
  return parse(src);
}

/**
 * 修复 Babel generator 对对象字面量/方法属性间行注释的错位问题。
 *
 * Babel 解析 `prop, // comment\n  nextProp` 时，会把 `// comment` 挂到下一个
 * 属性的 leadingComments，生成时输出在下一属性上方，导致注释视觉上"下移一行"。
 * 此函数将 `,\n  // comment\n  标识符` 还原为 `, // comment\n  标识符`。
 */
function fixMisplacedLineComments(code: string): string {
  // 1. 先处理连续两行注释、其中第一个本应属于上一属性行尾的情况：
  //    `prop,\n  //c1\n  //c2\n  nextKey` → `prop, //c1\n  //c2\n  nextKey`
  //    （c1 上移到上一属性行尾，c2 保持独占行）
  code = code.replace(
    /,\r?\n(\s*)(\/\/[^\r\n]*)\r?\n(\s*)(\/\/[^\r\n]*)\r?\n(\s*)(\w)/g,
    (_m, sp1, c1, sp2, c2, sp3, key) => `, ${c1}\r\n${sp2}${c2}\r\n${sp3}${key}`
  );
  // 2. 再处理单个行注释错位：
  //    `prop,\n  //comment\n  nextKey` → `prop, //comment\n  nextKey`
  code = code.replace(
    /,\r?\n(\s*)(\/\/[^\r\n]*)\r?\n(\s*)(\w)/g,
    (_m, _sp1, comment, sp2, key) => `, ${comment}\r\n${sp2}${key}`
  );
  return code;
}

export function outputObjectMethods(outPath: string, methods: ObjectMethod[]) {
  let dist = methods
    .map((m) => {
      // 区分处理 leadingComments：
      // - CommentBlock（/** ... */ JSDoc）：属于方法自身的文档注释，encode 扁平化时应删除。
      // - CommentLine（// ...）：Babel 会把上一属性/方法的行尾注释错挂到当前方法的
      //   leadingComments，删除会导致行尾注释丢失，因此保留，交由 fixMisplacedLineComments
      //   在生成后还原到上一属性行尾。
      if (m.leadingComments?.length) {
        m.leadingComments = m.leadingComments.filter(
          (c) => c.type === "CommentLine"
        );
        if (!m.leadingComments.length) {
          m.leadingComments = undefined;
        }
      }
      return m;
    })
    .map((m) => generate(m))
    .map((m) => m.code)
    .join(`,\n`);
  dist = dist.replace(/\n/gm, EOL);
  dist = fixMisplacedLineComments(dist);
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
  ignoreMod?: string[],
  rootDir?: string
): Map<string, string> {
  const modPathByName = new Map<string, string>();
  traverse(srcAst as Node, {
    Program(path) {
      path.node.body
        .filter((item) => types.isVariableDeclaration(item))
        .flatMap((item) => (item as VariableDeclaration).declarations)
        .filter((item) => {
          if (
            types.isCallExpression(item.init) &&
            types.isIdentifier(item.init.callee)
          ) {
            if (item.init.callee.name === "require") {
              if (types.isIdentifier(item.id)) {
                if (ignoreMod?.includes(item.id.name)) {
                  logger.info(`ignore module: ${item.id.name}`);
                } else {
                  return true;
                }
              }
            }
          }
          return false;
        })
        .forEach((item) => {
          const args = (item.init as CallExpression).arguments;
          if (args.length) {
            const modName = (item.id as Identifier).name;
            const modPath = (args[0] as StringLiteral).value;
            modPathByName.set(modName, scanfRequieMod(baseDir, modPath, rootDir));
          }
        });
    }
  });
  return modPathByName;
}

/**
 * 获取源码方法中引用的第三方模块方法名和自身模块方法名
 * @param mod - 依赖模块
 * @param entry - 入口对象
 * @param srcAst - 源码AST
 * @returns
 */
export function getRequireMethodNames(
  srcAst: AstType,
  entry: string,
  mod: string[]
): Map<string, string[]> {
  const methodsByMod = new Map<string, string[]>();
  traverse(srcAst as Node, {
    MemberExpression(path) {
      const invokeMethod = path.node.property;
      if (!types.isIdentifier(invokeMethod)) {
        return;
      }

      const invokeObj = path.node.object;
      let key: string | null = null;
      if (types.isIdentifier(invokeObj)) {
        key = invokeObj.name;
        if (!mod.includes(key)) {
          return;
        }
      } else if (types.isThisExpression(invokeObj)) {
        key = entry;
      }
      if (!key) {
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
  traverse(srcAst as Node, {
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
  traverse(srcAst as Node, {
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

      const objectMethodNode = path.findParent((p) =>
        types.isObjectMethod(p.node)
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

/**
 * 修改依赖方法调用者
 * @param srcAst
 * @param entry
 * @param mod
 * @param methods
 * @param root
 */
export function modifyObjectMethods(
  srcAst: AstType,
  entry: string,
  mod: Mod,
  methods: ObjectMethod[],
  root: boolean = false
) {
  const deps = Object.keys(mod.dependencies);
  const methodNames = getObjectMethodNames(methods);

  traverse(srcAst as Node, {
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
          if (
            types.isIdentifier(path.node.property) &&
            mod.dependencies[depName].methods.includes(path.node.property.name)
          ) {
            path.node.object = types.thisExpression();
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
    }
  });
}

/**
 * 获取调用方法中所依赖第三方模块方法名
 * @param srcAst
 * @param methodNames - 调用方法名
 * @param depNames - 依赖模块名
 * @returns
 */
export function getDependentMethodNames(
  srcAst: AstType,
  methodNames: string[],
  depNames: string[]
) {
  const methodNamesByDepName = new Map<string, string[]>();
  traverse(srcAst as Node, {
    MemberExpression(path) {
      const objectMethodNode = path.findParent((p) =>
        types.isObjectMethod(p.node)
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
 * @param useAlias - 是否使用 @ 别名路径
 */
export function importMods(
  outDir: string,
  srcAst: AstType,
  mapContext: MapContext,
  useAlias: boolean = false
) {
  const depNames = mapContext.getDependencyNameByMod("self");
  const rootDir = getParentRootDir() || config.baseDir;
  const importMods = depNames.map((name) => {
    const srcPath = mapContext.getAbsoluteSrcPathByMod(name)!;
    let requireFrom: string;
    if (useAlias && rootDir) {
      // 使用 @ 别名：@/xxx => baseDir/xxx
      const aliasPath = srcPath
        .replace(rootDir, "")
        .replace(/\\/g, "/")
        .replace(/\/index\.js$/, "")
        .replace(/\.js$/, "");
      // 确保 @ 别名路径格式为 @/xxx（@ 与路径之间必须有 /）
      requireFrom = aliasPath.startsWith("/") ? "@" + aliasPath : "@/" + aliasPath;
    } else {
      requireFrom = relative(
        outDir,
        srcPath.replace(/\/index\.js$/, "").replace(/\\index\.js$/, "").replace(/\.js$/, "")
      )
        .split(/[/\\]/)
        .join("/");
      // 确保相对路径以 ./ 开头（Node.js require 需要 ./ 前缀来区分本地模块和 npm 包）
      if (!requireFrom.startsWith(".") && !requireFrom.startsWith("/")) {
        requireFrom = "./" + requireFrom;
      }
    }
    const variableDeclarator = types.variableDeclarator(
      types.identifier(name),
      types.callExpression(types.identifier("require"), [
        types.stringLiteral(requireFrom)
      ])
    );
    return types.variableDeclaration("const", [variableDeclarator]);
  });

  traverse(srcAst as Node, {
    Program(path) {
      path.node.body.unshift(...importMods);
    }
  });
}

/**
 * 去除第三方模块方法
 * @param srcAst - 源码AST
 * @param mapContext
 * @param skipMethodKeys - 需要跳过（不删除、不还原）的方法完整名集合，
 *   元素形如 `method__mod`。用于稽核出方法体不一致的工具方法：
 *   保留其内联定义与 this.method__mod 调用，交由用户人工处理。
 */
export function deleteModMethods(
  srcAst: AstType,
  mapContext: MapContext,
  skipMethodKeys: Set<string> = new Set()
) {
  const deps = new Set<string>();
  mapContext
    .getModNames()
    .flatMap((name) => Object.keys(mapContext.getMod(name)?.dependencies!))
    .forEach((dep) => deps.add(dep));
  traverse(srcAst as Node, {
    ObjectMethod(path) {
      if (!types.isIdentifier(path.node.key)) {
        return;
      }
      const methodName = path.node.key.name;
      const split = methodName.split("__");
      if (split.length < 2) {
        return;
      }
      const depName = split.length ? split[split.length - 1] : "";
      // 稽核不一致的方法：保留内联定义，不删除
      if (skipMethodKeys.has(methodName)) {
        return;
      }
      deps.has(depName) && path.remove();
    }
  });
  traverse(srcAst as Node, {
    MemberExpression(path) {
      if (!types.isIdentifier(path.node.property)) {
        return;
      }
      const methodName = path.node.property.name;
      const split = methodName.split("__");
      if (split.length < 2) {
        return;
      }
      const depName = split[split.length - 1];
      if (deps.has(depName)) {
        // 稽核不一致的方法：保留 this.method__mod 调用形态，不还原
        if (skipMethodKeys.has(methodName)) {
          return;
        }
        path.node.property.name = methodName.replace(`__${depName}`, "");

        if (types.isThisExpression(path.node.object)) {
          path.node.object = types.identifier(depName);
        }
      }
    }
  });
}

/**
 * 获取方法内部调用的方法名
 * @param srcAst - 源码AST
 * @param entry - 入口
 * @param methodName - 方法名
 * @param mapContext
 */
export function getInlineMethodsByMethodName(
  srcAst: AstType,
  entry: string,
  methodName: string,
  useMethodNameMap: Map<string, string[]>
): string[] {
  const inlineMethods = new Set<string>();
  const selfMethods = useMethodNameMap.get(entry)!;
  const mods = [...useMethodNameMap.keys()];

  traverse(srcAst as Node, {
    MemberExpression(path) {
      const objectMethodPath = path.findParent((p) =>
        types.isObjectMethod(p.node)
      ) as NodePath<ObjectMethod> | null;
      if (!objectMethodPath) {
        return;
      }
      if (!types.isIdentifier(objectMethodPath.node.key)) {
        return;
      }
      if (objectMethodPath.node.key.name !== methodName) {
        return;
      }
      if (
        types.isThisExpression(path.node.object) &&
        types.isIdentifier(path.node.property)
      ) {
        if (selfMethods.includes(path.node.property.name)) {
          inlineMethods.add(`${entry}#${path.node.property.name}`);
        }
      }

      if (
        types.isIdentifier(path.node.object) &&
        types.isIdentifier(path.node.property)
      ) {
        const modName = path.node.object.name;
        const methodName = path.node.property.name;
        if (
          mods.includes(modName) &&
          useMethodNameMap.get(modName)!.includes(methodName)
        ) {
          inlineMethods.add(`${modName}#${methodName}`);
        }
      }
    }
  });
  return [...inlineMethods];
}

/**
 * 从 coded.js 的 AST 中提取未知的依赖名（__{mod} 后缀中的 mod）
 * 扫描 ObjectMethod 的 key 和 MemberExpression 的 property，提取 xxx__yyy 中的 yyy，
 * 排除已知依赖名（mod.map 中已有的依赖）。
 * @param srcAst - 源码AST
 * @param knownDeps - 已知依赖名集合
 * @returns 未知依赖名数组（去重）
 */
export function getUnknownDepNames(
  srcAst: AstType,
  knownDeps: Set<string>
): string[] {
  const depNames = new Set<string>();
  const collect = (name: string) => {
    const split = name.split("__");
    if (split.length < 2) {
      return;
    }
    // 取最后一段作为依赖名（与 deleteModMethods 的解析逻辑一致）
    const depName = split[split.length - 1];
    if (!depName || knownDeps.has(depName)) {
      return;
    }
    depNames.add(depName);
  };
  traverse(srcAst as Node, {
    ObjectMethod(path) {
      if (types.isIdentifier(path.node.key)) {
        collect(path.node.key.name);
      }
    },
    MemberExpression(path) {
      if (types.isIdentifier(path.node.property)) {
        collect(path.node.property.name);
      }
    }
  });
  return [...depNames];
}

/**
 * 稽核结果：方法体不一致的工具方法
 */
export interface AuditMismatch {
  /** 完整方法名，形如 `formatData__util` */
  methodKey: string;
  /** 原始方法名，形如 `formatData` */
  methodName: string;
  /** 依赖（模块）名，形如 `util` */
  modName: string;
  /** 源文件绝对路径（取不到时为空串） */
  srcPath: string;
}

/**
 * 递归清除节点及其子树上所有 comments 字段（leading/inner/trailing），
 * 用于“忽略注释”的代码比对。
 */
function stripCommentsDeep(node: Node) {
  if (!node || typeof node !== "object") {
    return;
  }
  // 处理数组节点
  if (Array.isArray(node)) {
    node.forEach((child) => stripCommentsDeep(child as Node));
    return;
  }
  const n = node as any;
  n.leadingComments = null;
  n.innerComments = null;
  n.trailingComments = null;
  for (const key of Object.keys(n)) {
    const val = n[key];
    if (val && typeof val === "object") {
      stripCommentsDeep(val as Node);
    }
  }
}

/**
 * 生成节点的归一化代码：去注释 + generate + 压缩空白/换行，
 * 使仅注释或排版差异的代码视为相同。
 */
function normalizeNodeCode(node: Node): string {
  // 克隆避免污染原 AST
  const cloned = JSON.parse(JSON.stringify(node)) as Node;
  stripCommentsDeep(cloned);
  const { code } = generate(cloned, { compact: true });
  // 压缩连续空白与换行，统一比较基准
  return code.replace(/\s+/g, " ").trim();
}

/**
 * 对单个克隆的方法节点，在其方法体内应用与 encode `modifyObjectMethods`
 * （非 root 分支）一致的调用重命名，使其与 coded.js 内联方法体可比对：
 *   - `this.method`（method 属于该 mod 自身方法集）→ `this.method__entry`
 *   - `dep.method`（dep 属于 mod.dependencies 且 method 在 dep.methods）→ `this.method__dep`
 * 同时把方法 key 由 `method` 重命名为 `method__entry`。
 *
 * 注意：仅作用于传入的方法节点子树，不污染原 AST（调用方需传入克隆节点）。
 */
function renameCallsInsideMethod(
  methodNode: ObjectMethod,
  entry: string,
  selfMethods: string[],
  deps: { name: string; methods: string[] }[]
) {
  // 重命名方法 key：method → method__entry
  if (types.isIdentifier(methodNode.key)) {
    methodNode.key.name = `${methodNode.key.name}__${entry}`;
  }
  // 在方法体内遍历 MemberExpression 做调用重命名
  // 使用 path 作用域限定在该方法节点内
  const selfSet = new Set(selfMethods);
  const depMap = new Map<string, Set<string>>();
  deps.forEach((d) => depMap.set(d.name, new Set(d.methods)));

  // 手动遍历方法体（避免引入完整 traverse 的作用域问题）
  const visit = (node: any) => {
    if (!node || typeof node !== "object") {
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((child) => visit(child));
      return;
    }
    if (types.isMemberExpression(node)) {
      // this.method → this.method__entry（method 属于自身方法集）
      if (
        types.isThisExpression(node.object) &&
        types.isIdentifier(node.property) &&
        selfSet.has(node.property.name)
      ) {
        node.property.name = `${node.property.name}__${entry}`;
      }
      // dep.method → this.method__dep
      if (
        types.isIdentifier(node.object) &&
        types.isIdentifier(node.property) &&
        depMap.has(node.object.name) &&
        depMap.get(node.object.name)!.has(node.property.name)
      ) {
        const depName = node.object.name;
        node.object = types.thisExpression();
        node.property.name = `${node.property.name}__${depName}`;
      }
    }
    for (const key of Object.keys(node)) {
      if (key === "loc" || key === "start" || key === "end" || key === "range") {
        continue;
      }
      const val = node[key];
      if (val && typeof val === "object") {
        visit(val);
      }
    }
  };
  visit(methodNode);
}

/**
 * 稽核 coded.js 中内联工具方法的方法体是否与源文件一致（忽略注释）。
 *
 * 比对基准：对源文件中对应方法应用与 encode 一致的重命名后，生成归一化代码，
 * 与 coded.js 内联方法体的归一化代码比对。若不一致，说明 coded.js 被手动修改
 * 或源文件已漂移，应跳过该方法的 decode（保留内联定义与 this.method__mod 调用）。
 *
 * @param srcAst - coded.js 的 AST（已包裹为 mount 对象）
 * @param mapContext - mod.map 上下文
 * @returns 不一致的方法列表
 */
export function auditModMethods(
  srcAst: AstType,
  mapContext: MapContext
): AuditMismatch[] {
  const mismatches: AuditMismatch[] = [];
  // 所有已知依赖名并集（与 deleteModMethods 一致）
  const deps = new Set<string>();
  mapContext
    .getModNames()
    .flatMap((name) => Object.keys(mapContext.getMod(name)?.dependencies!))
    .forEach((dep) => deps.add(dep));

  // 缓存源文件 AST，避免重复解析
  const srcAstCache = new Map<string, AstType>();
  const getSrcAst = (modName: string): AstType => {
    if (srcAstCache.has(modName)) {
      return srcAstCache.get(modName)!;
    }
    const srcPath = mapContext.getAbsoluteSrcPathByMod(modName);
    const ast = srcPath ? parseSrcAst(srcPath) : undefined;
    srcAstCache.set(modName, ast);
    return ast;
  };

  traverse(srcAst as Node, {
    ObjectMethod(path) {
      if (!types.isIdentifier(path.node.key)) {
        return;
      }
      const fullMethodName = path.node.key.name;
      const split = fullMethodName.split("__");
      if (split.length < 2) {
        return;
      }
      const depName = split[split.length - 1];
      if (!deps.has(depName)) {
        return;
      }
      // 原始方法名：去掉 __depName 后缀
      const originalName = fullMethodName.slice(
        0,
        fullMethodName.length - depName.length - 2
      );

      const srcPath = mapContext.getAbsoluteSrcPathByMod(depName);
      const depSrcAst = getSrcAst(depName);
      if (!depSrcAst || !srcPath) {
        // 源文件不可读，无法稽核，跳过（不视为不一致）
        return;
      }

      // 从源文件取出对应方法节点
      const srcMethods = getObjectMethodsByEntryAndMethodNames(
        depSrcAst,
        depName,
        [originalName]
      );
      if (!srcMethods.length) {
        // 源文件中找不到该方法，视为不一致（源文件已变更）
        mismatches.push({
          methodKey: fullMethodName,
          methodName: originalName,
          modName: depName,
          srcPath
        });
        return;
      }

      // 克隆源方法节点，应用 encode 重命名，归一化
      // 自身方法集取源文件中该 entry 对象的所有方法名（与 encode modifyObjectMethods 一致），
      // 而非 mod.map 的引用集（补充依赖场景下引用集可能为空）
      const allSrcMethods = getObjectMethodsByEntryAndMethodNames(depSrcAst, depName);
      const selfMethodNames = getObjectMethodNames(allSrcMethods);
      const srcCloned = JSON.parse(JSON.stringify(srcMethods[0])) as ObjectMethod;
      const mod = mapContext.getMod(depName);
      const depEntries = mod
        ? Object.keys(mod.dependencies).map((name) => ({
            name,
            methods: mod.dependencies[name].methods
          }))
        : [];
      renameCallsInsideMethod(
        srcCloned,
        depName,
        selfMethodNames,
        depEntries
      );
      const srcNormalized = normalizeNodeCode(srcCloned);

      // coded.js 内联方法节点归一化（直接比对，已是重命名后形态）
      const codedCloned = JSON.parse(
        JSON.stringify(path.node)
      ) as ObjectMethod;
      const codedNormalized = normalizeNodeCode(codedCloned);

      if (srcNormalized !== codedNormalized) {
        mismatches.push({
          methodKey: fullMethodName,
          methodName: originalName,
          modName: depName,
          srcPath
        });
      }
    }
  });

  return mismatches;
}

/**
 * 检测入口对象内是否含有 `__mod` 后缀的方法定义。
 *
 * 用于 encode 防护：当源文件（index.js）的 mount 对象内残留带 `__mod` 后缀的方法时，
 * 说明用户直接复用了 decode 产物（含未还原的内联工具方法）作为二开源文件。
 * 此类源文件不应再通过 require 引入工具方法做依赖编码，否则会导致方法重复定义、
 * mod.map 错乱。encode 检测到此场景应禁止 require 引入，只做无依赖编码。
 *
 * @param srcAst - 源码AST
 * @param entry - 入口对象名
 * @returns 含 `__mod` 后缀的方法名列表（如 `["validate__util", "fetchData__util"]`）
 */
export function getInlinedModMethodNames(
  srcAst: AstType,
  entry: string
): string[] {
  const inlinedNames: string[] = [];
  // 取入口对象的所有方法，筛选出 key 含 __ 后缀的
  const methods = getObjectMethodsByEntryAndMethodNames(srcAst, entry);
  methods.forEach((method) => {
    if (!types.isIdentifier(method.key)) {
      return;
    }
    const name = method.key.name;
    if (name.split("__").length >= 2) {
      inlinedNames.push(name);
    }
  });
  return inlinedNames;
}
