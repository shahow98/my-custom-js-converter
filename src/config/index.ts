import fs from "fs";
import path from "path";

export default config();

export namespace Config {
  export interface MainConfig {
    encode: EncodeConfig;
    decode: DecodeConfig;
    baseDir: string;
    target: string[];
    customConfig: string;
  }

  export interface SubConfig {
    mod: Array<Mod>;
    version: string;
  }

  export interface EncodeConfig {
    file: string;
    output: string;
    entry: string;
    ignoreMod: string[];
  }

  export interface DecodeConfig {
    file: string;
    output: string;
    mount: string;
  }

  export class Mod {
    name: string;
    path: string;
    constructor(name: string, path: string) {
      this.name = name;
      this.path = path;
    }
  }
}


function config(): Config.MainConfig {
  const defConfig: Config.MainConfig = {
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
    customConfig: "config.json",
  };

  const curDir = __dirname;
  const baseDir = curDir.replace(/node_modules.*/g, "");
  try {
    const configPath = path.join(baseDir, defConfig.customConfig);
    fs.accessSync(configPath);
    const json = fs.readFileSync(configPath, { encoding: "utf-8" });
    const customConfig = JSON.parse(json) as Config.MainConfig;
    defConfig.baseDir = baseDir;
    defConfig.target = customConfig.target;
    defConfig.encode = customConfig.encode;
    defConfig.decode = customConfig.decode;
  } catch (err) {}
  return defConfig;
}