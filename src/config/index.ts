import fs from "fs";
import path from "path";
import { MainConfig } from "./main_config";

export const config = initConfig();

function initConfig(): MainConfig {
  const defConfig: MainConfig = {
    encode: {
      file: "index.js",
      output: "coded.js",
      entry: "customEvent",
      ignoreMod: ["commonUtil"],
      useAlias: false,
    },
    decode: {
      file: "coded.js",
      output: "decoded.js",
      mount: "customEvent",
    },
    baseDir: "",
    target: [""],
    settingDir: ".setting",
    customConfig: "config.js",
  };

  const curDir = __dirname;
  let baseDir = curDir.replace(/node_modules.*/g, "");
  // 当 __dirname 不包含 node_modules 时（如 junction symlink 场景），
  // 尝试从 process.cwd() 查找配置文件
  if (!curDir.includes("node_modules")) {
    baseDir = process.cwd();
  }
  // 尝试查找配置文件：先 customConfig 指定的文件名，再 config.json
  const configCandidates = [defConfig.customConfig, "config.json"];
  for (const configName of configCandidates) {
    try {
      const configPath = path.join(baseDir, configName);
      fs.accessSync(configPath);
      let customConfig: MainConfig;
      if (configPath.endsWith(".js")) {
        // 支持 .js 配置文件，可使用注释
        customConfig = require(configPath) as MainConfig;
      } else {
        // 兼容 .json 配置文件
        const json = fs.readFileSync(configPath, { encoding: "utf-8" });
        customConfig = JSON.parse(json) as MainConfig;
      }
      defConfig.baseDir = baseDir;
      Object.keys(customConfig).map(key => key as keyof typeof customConfig).forEach((key) => {
        if(customConfig[key]) {
          defConfig[key] = customConfig[key] as any;
        }
      });
      // baseDir 允许从配置文件中显式覆盖
      if (customConfig.baseDir) {
        defConfig.baseDir = customConfig.baseDir;
      }
      break;
    } catch (err) {
      continue;
    }
  }
  return defConfig;
}