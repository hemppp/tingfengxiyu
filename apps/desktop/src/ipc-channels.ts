// ============================================================
// apps/desktop/src/ipc-channels.ts
// IPC 通道名字面量**唯一真源**（ADR-0008 D11.2，已冻结）。
//
// 主进程（main.ts）与 preload（preload.ts）**共用本文件常量**，
// 任何一侧都不得再写裸字符串。
//
// 冻结约束（D11.2 末段逐字）：
//   「**恰好这 9 条**。新增任何通道必须回到 captain 开 ADR 修订。」
// ============================================================

/**
 * 9 条 IPC 通道名，逐字来自 ADR-0008 D11.2 的冻结表。
 *
 * | 通道名字面量 | 对应 preload 方法 |
 * |---|---|
 * | `novelmuse:app:get-version`      | `getVersion` |
 * | `novelmuse:app:get-data-path`    | `getDataPath` |
 * | `novelmuse:app:relaunch`         | `relaunch` |
 * | `novelmuse:updater:get-state`    | `updaterGetState` |
 * | `novelmuse:updater:set-base-url` | `updaterSetBaseUrl` |
 * | `novelmuse:updater:check`        | `updaterCheck` |
 * | `novelmuse:updater:apply-app`    | `updaterApplyApp` |
 * | `novelmuse:updater:install-plugin` | `updaterInstallPlugin` |
 * | `novelmuse:updater:relaunch`     | `updaterRelaunch` |
 */
export const IPC = {
  appGetVersion: 'novelmuse:app:get-version',
  appGetDataPath: 'novelmuse:app:get-data-path',
  appRelaunch: 'novelmuse:app:relaunch',
  updaterGetState: 'novelmuse:updater:get-state',
  updaterSetBaseUrl: 'novelmuse:updater:set-base-url',
  updaterCheck: 'novelmuse:updater:check',
  updaterApplyApp: 'novelmuse:updater:apply-app',
  updaterInstallPlugin: 'novelmuse:updater:install-plugin',
  updaterRelaunch: 'novelmuse:updater:relaunch',
} as const;

/** 单条通道名联合类型。 */
export type IpcChannel = (typeof IPC)[keyof typeof IPC];

/**
 * 全部通道名的运行期清单。
 * 主进程用它逐条 `ipcMain.handle`，preload 用它校验「恰好 9 条」。
 */
export const IPC_CHANNELS: readonly IpcChannel[] = [
  IPC.appGetVersion,
  IPC.appGetDataPath,
  IPC.appRelaunch,
  IPC.updaterGetState,
  IPC.updaterSetBaseUrl,
  IPC.updaterCheck,
  IPC.updaterApplyApp,
  IPC.updaterInstallPlugin,
  IPC.updaterRelaunch,
];

/** 冻结通道数（D11.2「恰好这 9 条」）。 */
export const IPC_CHANNEL_COUNT = 9;