import { Dependencies, Dependency, MapConfig, Mod } from "../config/map_config";
import fs from "fs";
import path from "path";
import {
  getRequireMethodNames,
  getRequireModPaths,
  getObjectMethodNames,
  parseSrcAst,
  getObjectMethodsByEntryAndMethodNames
} from "../util/ast";
import { EncodeConfig, MainConfig } from "../config/main_config";

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

  static readFromLocal(inDir: string): MapContext {
    const inPath = path.join(inDir, MapContext.SAVE_FILE);
    console.log(`input map => ${inPath}`);
    const json = fs.readFileSync(inPath, { encoding: "utf-8" });
    const map = JSON.parse(json) as MapConfig;
    const mapContext = new MapContext();
    Object.keys(map).forEach((name) => mapContext.appendModMap(map[name], false, name));
    return mapContext;
  }

  private init() {
    this.buildMapContext(this.srcPath, this.entry, true);
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
      return;
    }

    const requireModPathByName = getRequireModPaths(
      path.dirname(inPath),
      srcAst
    );
    const requireModNames = [...requireModPathByName.keys()].map(
      (name) => name
    );
    const requireMethodNamesByMod = getRequireMethodNames(
      srcAst,
      requireModNames
    );
    const dependencies = new Dependencies();
    requireModNames.forEach((name) => {
      const dep = new Dependency(requireMethodNamesByMod.get(name));
      dependencies[name] = dep;
    });

    const mod = new Mod(inPath, dependencies);
    this.appendModMap(mod, root, entry);

    [...requireModPathByName.entries()].forEach(([name, modPath]) => {
      this.buildMapContext(modPath, name, false);
    });
  }
}
