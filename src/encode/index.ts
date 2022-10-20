import path from "path";
import { scanfCodeFiles, scanfCodeDirs } from "../scanf";
import { config } from "../config";
import { ObjectMethod } from "@babel/types";
import { MainConfig } from "../config/main_config";
import { MapContext } from "../context/map_context";
import {
  getObjectMethodsByEntryAndMethodNames,
  parseSrcAst,
  getObjectMehtodsByMehtodNamesAndInsideOwnMethods,
  outputObjectMethods,
  modifyObjectMethods
} from "../util/ast";

(function encoding(config: MainConfig) {
  const encodeConfig = config.encode;
  const targetDirs = scanfCodeDirs(config.baseDir, config.target);
  console.log("scanf dirs => ");
  console.log(targetDirs);
  const codeFiles = scanfCodeFiles(targetDirs, encodeConfig.file);
  codeFiles.forEach((inPath) => {
    const workDir = path.dirname(inPath);
    console.log(`scanf file => ${inPath}`);
    const mapContext = new MapContext(
      inPath,
      encodeConfig.entry,
      path.join(workDir, config.settingDir),
      true
    );

    const methods = encoding$0(mapContext, encodeConfig.entry);

    const outPath = path.join(workDir, encodeConfig.output);
    console.log(`output file => ${outPath}`);
    outputObjectMethods(outPath, methods);
  });
})(config);

function encoding$0(mapContext: MapContext, entry: string): ObjectMethod[] {
  const modNames = mapContext.getModNames();
  return modNames.flatMap((name) => {
    const mod = mapContext.getMod(name);
    const srcAst = parseSrcAst(mod?.src);
    // console.log(`import => ${name}`);
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
