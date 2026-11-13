/**
 * 「今日调用次数」进程内计数器。
 * 用于数据看板统计 FastGPT 拉取调用量；进程重启归零。
 * 独立成模块（而非放在 route 里），使路由文件只含路由 handler。
 */

let todayCalls = 0;
let todayDate = new Date().toISOString().slice(0, 10);

/** FastGPT list 接口每次被调用时递增计数（跨日自动清零）。 */
export function bumpTodayCalls(by = 1): number {
  const now = new Date().toISOString().slice(0, 10);
  if (now !== todayDate) {
    todayDate = now;
    todayCalls = 0;
  }
  todayCalls += by;
  return todayCalls;
}

/** 读取当前「今日调用次数」。 */
export function readTodayCalls(): number {
  const now = new Date().toISOString().slice(0, 10);
  if (now !== todayDate) {
    todayDate = now;
    todayCalls = 0;
  }
  return todayCalls;
}

/** 重置（测试用）。 */
export function resetTodayCalls(): void {
  todayCalls = 0;
  todayDate = new Date().toISOString().slice(0, 10);
}