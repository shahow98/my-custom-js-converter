import { Dependencies, Dependency, MapConfig, Mod } from "../config/map_config";
import fs from "fs";
import path from "path";
import {
  getRequireMethodNames,
  getRequireModPaths,
  getObjectMethodNames,
  parseSrcAst,
  getObjectMethodsByEntryAndMethodNames,
  AstType,
  getInlineMethodsByMethodName
} from "../util/ast";
import { getParentRootDir } from "../util/parent_path";

export class MapContext {
  static SAVE_FILE = "mod.map";

  private srcPath: string;

  private entry: string;

  private outDir: string;

  private map: MapConfig;

  constructor(
    srcPath: string = "",
    entry: string = "",
    outDir: string = "",
    initMap: boolean = false
  ) {
    this.map = new MapConfig();
    this.srcPath = srcPath;
    this.entry = entry;
    this.outDir = outDir;
    initMap && this.init();
  }

  appendModMap(mod: Mod, self: boolean, name: string = "") {
    const key = self ? "self" : name;
    this.map[key] = mod;
  }

  getModNames(): string[] {
    return Object.keys(this.map);
  }

  getMod(name: string): Mod | null | undefined {
    return this.map[name];
  }

  getMethodNamesByMod(name: string): string[] {
    const methodNames = new Set<string>();
    Object.keys(this.map)
      .map((modName) => this.map[modName]?.dependencies[name]?.methods)
      .filter((methods) => methods)
      .flatMap((methods) => methods)
      .forEach((methods) => methodNames.add(methods));
    return [...methodNames];
  }

  getDependencyNameByMod(name: string): string[] {
    const mod = this.getMod(name);
    const deps = mod?.dependencies;
    if (deps) {
      return Object.keys(deps);
    }
    return [];
  }

  getSrcPathByMod(name: string): string | undefined {
    return this.getMod(name)?.src;
  }

  getAbsoluteSrcPathByMod(name: string): string | undefined {
    const srcPath = this.getSrcPathByMod(name);
    const parentRootDir = getParentRootDir();
    return parentRootDir && srcPath
      ? path.resolve(parentRootDir, srcPath)
      : srcPath;
  }

  static readFromLocal(inDir: string): MapContext {
    const inPath = path.join(inDir, MapContext.SAVE_FILE);
    console.log(`input map => ${inPath}`);
    try {
      const json = fs.readFileSync(inPath, { encoding: "utf-8" });
      const map = JSON.parse(json) as MapConfig;
      const mapContext = new MapContext();
      Object.keys(map).forEach((name) =>
        mapContext.appendModMap(map[name], false, name)
      );
      return mapContext;
    } catch (err) {
      console.log("the map is not found!");
      // console.log(err);
    }
    return new MapContext();
  }

  private init() {
    this.buildMapContext(this.srcPath, this.entry, true);
    this.filtering();
    this.shaking();
    this.writeToLocal();
  }

  private writeToLocal() {
    const outPath = path.join(this.outDir, MapContext.SAVE_FILE);
    console.log(`output map => ${outPath}`);
    const json = JSON.stringify(this.map, null, 4);
    try {
      fs.accessSync(this.outDir);
    } catch (err) {
      fs.mkdirSync(this.outDir);
    }
    fs.writeFileSync(outPath, json, "utf-8");
  }

  private buildMapContext(inPath: string, entry: string, root: boolean) {
    const srcAst = parseSrcAst(inPath);

    const srcMethodNames = getObjectMethodNames(
      getObjectMethodsByEntryAndMethodNames(srcAst, entry)
    );
    if (!srcMethodNames.length) {
      console.log(`not found entry => ${entry}`);
      this.appendModMap(new Mod(inPath, new Dependencies()), root, entry);
      return;
    }

    const requireModPathByName = getRequireModPaths(
      path.dirname(inPath),
      srcAst
    );
    const requireModNames = [...requireModPathByName.keys()].map(
      (name) => name
    );
    !root && requireModNames.unshift(entry);
    const requireMethodNamesByMod = getRequireMethodNames(
      srcAst,
      entry,
      requireModNames
    );
    const dependencies = new Dependencies();
    requireModNames.forEach((name) => {
      const dep = new Dependency(requireMethodNamesByMod.get(name));
      dependencies[name] = dep;
    });

    const parentRootDir = getParentRootDir();
    const mod = new Mod(
      parentRootDir ? path.relative(parentRootDir, inPath) : inPath,
      dependencies
    );
    this.appendModMap(mod, root, entry);

    [...requireModPathByName.entries()].forEach(([name, modPath]) => {
      this.buildMapContext(modPath, name, false);
    });
  }

  /**
   * 过滤self的dependencies中无效方法
   */
  private filtering() {
    this.getModNames().forEach((modName) => {
      const mod = this.getMod(modName)!;
      const dependencies = mod.dependencies;
      Object.keys(dependencies).forEach((depName) => {
        const srcAst = parseSrcAst(this.getAbsoluteSrcPathByMod(depName));
        const methodNames = getObjectMethodNames(
          getObjectMethodsByEntryAndMethodNames(
            srcAst,
            depName,
            dependencies[depName].methods
          )
        );
        dependencies[depName].methods = methodNames;
      });
    });
  }

  /**
   * 去除dependencies中未使用方法
   */
  private shaking() {
    const astMap = new Map<string, AstType>();
    this.getModNames().forEach((mod) => {
      astMap.set(mod, parseSrcAst(this.getAbsoluteSrcPathByMod(mod)));
    });
    const useMethodNameMap = new Map<string, string[]>();
    this.getModNames().forEach((mod) => {
      useMethodNameMap.set(mod, this.getMethodNamesByMod(mod));
    });
    const dependencies = this.getMod("self")!.dependencies;
    const filterMethodMap = new Map<string, Set<string>>();
    const readyStack = Object.keys(dependencies).flatMap((name) =>
      dependencies[name].methods.map((method) => [name, method])
    );
    while (readyStack.length) {
      const method = readyStack.shift()!;
      let filterMethods = new Set<string>();
      if (filterMethodMap.has(method[0])) {
        filterMethods = filterMethodMap.get(method[0])!;
      }
      filterMethods.add(method[1]);
      filterMethodMap.set(method[0], filterMethods);

      const inlineMethods = getInlineMethodsByMethodName(
        astMap.get(method[0]),
        method[0],
        method[1],
        useMethodNameMap
      );
      readyStack.push(...inlineMethods.map((m) => m.split("#")));
    }

    [...filterMethodMap.keys()].forEach((fMod) => {
      const filterMethods = filterMethodMap.get(fMod)!;
      this.getModNames().forEach((modName) => {
        const dep = this.getMod(modName)?.dependencies[fMod];
        if (dep) {
          dep.methods = dep.methods.filter((m) => filterMethods.has(m));
        }
      });
    });
  }
}
