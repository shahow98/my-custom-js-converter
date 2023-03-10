import path from "path";
import fs from "fs";
import { EOL } from "os";
import prettier from "prettier";
import { config } from "../config";
import { MainConfig } from "../config/main_config";
import { scanfCodeDirs, scanfCodeFiles } from "../scanf";
import { deleteModMethods, importMods } from "../util/ast";
import { MapContext } from "../context/map_context";
import generate from "@babel/generator";
import { parse } from "@babel/parser";
import { types } from "@babel/core";

(function decoding(config: MainConfig) {
  const targetDirs = scanfCodeDirs(config.baseDir, config.target);
  console.log("scanf dirs => ");
  console.log(targetDirs);
  const codeFiles = scanfCodeFiles(targetDirs, config.decode.file);
  codeFiles.forEach((inPath) => {
    console.log(`scanf file => ${inPath}`);
    const outPath = path.join(path.dirname(inPath), config.decode.output);
    decoding$0(inPath, outPath, config);
    console.log(`output => ${outPath}`);
  });
})(config);

/**
 * 解码
 * @param inPath - 源文件路径
 * @param outPath - 输入文件路径
 * @param mount - 方法挂载点
 */
function decoding$0(inPath: string, outPath: string, config: MainConfig) {
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
  let { code: dist } = generate(srcAst, { compact: true });
  dist = dist.replace(/},\n\n/g, `},${EOL}`);
  dist = prettier.format(dist, {
    parser: "babel",
    trailingComma: "none"
  });
  fs.writeFileSync(outPath, dist, "utf-8");
}
