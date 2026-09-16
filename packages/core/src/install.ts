// ============================================================
// @novel/core - 插件安装标准（novel-plugin-standard/1.0）
//
// 目标：任何插件（内置 / 本地 / npm）进入宿主前必须通过统一的
// "安装门"校验，任何一门失败都只隔离该插件并给出标准错误码，
// 绝不允许单个坏插件拖垮宿主启动或运行。
//
// 本文件只放纯函数（不触碰 fs / 网络），供宿主与扫描器做薄封装，
// 便于在任意端（server / web / 测试）复用同一套判定逻辑。
//
// 五道安装门：
//   G0 Manifest 门  —— plugin.json 可解析且通过 schema 校验
//   G1 结构门       —— 入口文件存在、路径安全（宿主封装 fs 部分）
//   G2 身份门       —— id 合法且全局唯一、目录名匹配
//   G3 版本门       —— minHostVersion ≤ 宿主版本
//   G4 依赖门       —— dependsOn 存在、未禁用、无循环（挂载期拓扑排序）
//   G5 注入门       —— inject 服务宿主可提供（挂载期拓扑排序一并判定）
// ============================================================

import type { PluginManifest } from './manifest.js';
import { satisfiesMinVersion } from './manifest.js';
import { HOST_VERSION } from './loader.js';

/** 标准版本号（随标准正文 docs/architecture/plugin-standard.md 同步演进） */
export const INSTALL_STANDARD_VERSION = '1.0.0';

/** 标准错误码：出现任何一个都表示插件被拒绝安装/挂载（不会拖垮宿主） */
export const INSTALL_ERROR_CODES = [
  'MANIFEST_INVALID',       // G0 manifest 缺失 / JSON 非法 / schema 校验失败
  'ENTRY_MISSING',          // G1 声明的入口文件不存在
  'ENTRY_UNSAFE',           // G1 入口路径越界（绝对路径 / .. 穿越 / 符号链接逃逸）
  'ID_MISMATCH',            // G2 本地目录名与 id 不匹配
  'ID_CONFLICT',            // G2 id 与已注册插件重复
  'HOST_VERSION_MISMATCH',  // G3 宿主版本低于插件要求的 minHostVersion
  'DEP_MISSING',            // G4 硬依赖不存在或已被禁用
  'DEP_CYCLE',              // G4 循环依赖
  'INJECT_MISSING',         // G5 声明注入的服务宿主无法提供
  'APPLY_MISSING',          // 模块缺少 apply() 导出
  'LOAD_FAILED',            // 入口模块加载/执行抛错
] as const;

export type InstallErrorCode = (typeof INSTALL_ERROR_CODES)[number];

/** 一条安装校验问题（code 面向程序，message 面向插件作者） */
export interface InstallIssue {
  code: InstallErrorCode;
  pluginId: string;
  message: string;
}

export interface InstallPolicyOptions {
  /** 当前宿主版本（缺省用 core 的 HOST_VERSION） */
  hostVersion?: string;
  /** 已知插件 id 集合：提供时做依赖存在性检查，缺省跳过（挂载期由拓扑排序兜底） */
  knownPluginIds?: Iterable<string>;
  /** 已禁用插件 id 集合：硬依赖被禁用视为不可满足（标准规定：跳过该插件） */
  disabledPluginIds?: Iterable<string>;
}

/**
 * G3 版本门 + G4 依赖静态检查（manifest 层面的策略校验）。
 * 返回全部问题（空数组 = 通过）；G0/G1/G2/G5 由宿主与扫描器各自把关。
 */
export function checkManifestPolicy(manifest: PluginManifest, opts: InstallPolicyOptions = {}): InstallIssue[] {
  const issues: InstallIssue[] = [];
  const hostVersion = opts.hostVersion ?? HOST_VERSION;

  // G3 版本门
  if (manifest.minHostVersion && !satisfiesMinVersion(hostVersion, manifest.minHostVersion)) {
    issues.push({
      code: 'HOST_VERSION_MISMATCH',
      pluginId: manifest.id,
      message: `宿主版本 ${hostVersion} 低于插件要求的最低版本 ${manifest.minHostVersion}，请升级宿主或换用兼容版本插件`,
    });
  }

  // G4 依赖静态检查
  const known = opts.knownPluginIds ? new Set(opts.knownPluginIds) : null;
  const disabled = new Set(opts.disabledPluginIds ?? []);
  for (const dep of manifest.dependsOn ?? []) {
    if (dep === manifest.id) {
      issues.push({ code: 'DEP_CYCLE', pluginId: manifest.id, message: `插件依赖自身（dependsOn 含 ${dep}）` });
      continue;
    }
    if (disabled.has(dep)) {
      issues.push({
        code: 'DEP_MISSING',
        pluginId: manifest.id,
        message: `硬依赖 ${dep} 已被禁用（标准规定：硬依赖不可用时插件跳过）。请先启用 ${dep}，或改用无依赖方案`,
      });
      continue;
    }
    if (known && !known.has(dep) && !disabled.has(dep)) {
      issues.push({
        code: 'DEP_MISSING',
        pluginId: manifest.id,
        message: `硬依赖 ${dep} 不存在（检查 id 拼写，或先安装该插件）`,
      });
    }
  }
  return issues;
}

/**
 * 本地插件目录名与 id 的匹配规则（G2 身份门）：
 * 允许「完整 id 作目录名」（AI create_plugin 形态，防短名碰撞）
 * 或「id 尾段作目录名」（手写插件形态，如 typography/）。
 */
export function localDirMatchesId(dirName: string, id: string): boolean {
  return dirName === id || dirName === id.split('.').pop();
}
