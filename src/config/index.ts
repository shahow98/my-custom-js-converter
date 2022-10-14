import fs from "fs";
import path from "path";
import { MainConfig } from "./main_config";
import { SubConfig } from "./sub_config";

export default config();

function config(): MainConfig {
  const defConfig: MainConfig = {
    encode: {
      file: "index.js",
      output: "coded.js",
      entry: "customEvent",
      ignoreMod: ["commonUtil"],
    },
    decode: {
      file: "coded.js",
      output: "decoded.js",
      mount: "customEvent",
    },
    baseDir: "",
    target: [""],
    workDir: ".setting",
    customConfig: "config.json",
  };

  const curDir = __dirname;
  const baseDir = curDir.replace(/node_modules.*/g, "");
  try {
    const configPath = path.join(baseDir, defConfig.customConfig);
    fs.accessSync(configPath);
    const json = fs.readFileSync(configPath, { encoding: "utf-8" });
    const customConfig = JSON.parse(json) as MainConfig;
    defConfig.baseDir = baseDir;
    Object.keys(customConfig).map(key => key as keyof typeof customConfig).forEach((key) => {
      if(customConfig[key]) {
        defConfig[key] = customConfig[key] as any;
      }
    });
  } catch (err) {}
  return defConfig;
}