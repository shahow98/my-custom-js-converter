export interface MainConfig {
  encode: EncodeConfig;
  decode: DecodeConfig;
  baseDir: string;
  target: string[];
  settingDir: string;
  customConfig: string;
  /**
   * 依赖库搜索目录数组，用于 decode 时补充缺失依赖。
   * 支持 "@/util" 别名路径（@ 代表项目根目录）和 "util" 相对 baseDir 路径。
   */
  libs: string[];
}

export interface EncodeConfig {
  file: string;
  output: string;
  entry: string;
  ignoreMod: string[];
  useAlias: boolean;
}

export interface DecodeConfig {
  file: string;
  output: string;
  mount: string;
}