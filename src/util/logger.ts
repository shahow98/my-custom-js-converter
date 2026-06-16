/**
 * 统一日志工具模块
 * 提供带 scope 前缀和状态图标的日志函数
 */

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  step(title: string): void;
}

/**
 * 创建带 scope 前缀的 logger
 * @param scope - 日志前缀，如 'encode' / 'decode'
 */
export function createLogger(scope: string): Logger {
  return {
    info(msg: string) {
      console.log(`[${scope}] ✔ ${msg}`);
    },
    warn(msg: string) {
      console.log(`[${scope}] ⚠ ${msg}`);
    },
    error(msg: string) {
      console.log(`[${scope}] ✖ ${msg}`);
    },
    step(title: string) {
      const line = "─".repeat(Math.max(0, 50 - title.length));
      console.log(`\n[${scope}] ── ${title} ${line}`);
    }
  };
}
