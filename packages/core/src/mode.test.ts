// ============================================================
// 插件适用模式 + 目录布局 + 安装门 MODE_MISMATCH 测试
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  validateManifest,
  pluginModeFromDir,
  pluginAppliesToProjectMode,
  checkPluginModeConsistency,
  checkManifestPolicy,
  PLUGIN_MODES,
  type PluginManifest,
  type PluginMode,
  type ProjectMode,
} from './index';

const baseManifest: PluginManifest = {
  id: 'novel.typography',
  name: '字体排版',
  version: '0.1.0',
  permissions: ['routes'],
  serverEntry: './server/index.ts',
};

describe('PluginMode 白名单与 manifest.modes 字段', () => {
  it('PLUGIN_MODES 恰为 manual/auto/shared（无空承诺）', () => {
    expect([...PLUGIN_MODES]).toEqual(['manual', 'auto', 'shared']);
  });

  it('modes 缺省：不传时解析结果无该字段（由消费方按 shared 兜底）', () => {
    const m = validateManifest(baseManifest);
    expect(m.modes).toBeUndefined();
  });

  it('modes 显式声明时原样保留', () => {
    const m = validateManifest({ ...baseManifest, modes: ['manual'] });
    expect(m.modes).toEqual(['manual']);
  });

  it('拒绝白名单外的模式值', () => {
    expect(() => validateManifest({ ...baseManifest, modes: ['hybrid'] as never })).toThrow(/manifest 校验失败/);
  });
});

describe('目录推导：pluginModeFromDir', () => {
  it('manual/auto/shared 同名映射', () => {
    expect(pluginModeFromDir('manual')).toBe('manual');
    expect(pluginModeFromDir('auto')).toBe('auto');
    expect(pluginModeFromDir('shared')).toBe('shared');
  });

  it('local 默认为 shared（AI 动态创建区）', () => {
    expect(pluginModeFromDir('local')).toBe('shared');
  });

  it('未知目录名返回 null', () => {
    expect(pluginModeFromDir('builtin')).toBeNull();
    expect(pluginModeFromDir('')).toBeNull();
  });
});

describe('适用判定：pluginAppliesToProjectMode 真值表', () => {
  const table: Array<[PluginMode[] | undefined, ProjectMode, boolean]> = [
    [['manual'], 'manual', true],
    [['manual'], 'auto', false],
    [['auto'], 'auto', true],
    [['auto'], 'manual', false],
    [['shared'], 'manual', true],
    [['shared'], 'auto', true],
    [undefined, 'manual', true],   // 缺省 → shared
    [undefined, 'auto', true],     // 缺省 → shared
    [[], 'manual', true],          // 空数组 → shared
    [[], 'auto', true],
  ];

  it.each(table)('modes=%j × project=%s → %s', (modes, project, expected) => {
    expect(pluginAppliesToProjectMode(modes, project)).toBe(expected);
  });
});

describe('安装门 G2.5：checkPluginModeConsistency（MODE_MISMATCH）', () => {
  it('目录与 modes 一致 → 通过', () => {
    expect(checkPluginModeConsistency('manual', { ...baseManifest, modes: ['manual'] })).toBeNull();
    expect(checkPluginModeConsistency('auto', { ...baseManifest, modes: ['auto'] })).toBeNull();
    expect(checkPluginModeConsistency('shared', { ...baseManifest, modes: ['shared'] })).toBeNull();
  });

  it('modes 缺省视为 shared：manual/auto 目录缺省仍拒绝，shared/local 目录缺省通过', () => {
    expect(checkPluginModeConsistency('shared', baseManifest)).toBeNull();
    expect(checkPluginModeConsistency('local', baseManifest)).toBeNull();
    expect(checkPluginModeConsistency('manual', baseManifest)?.code).toBe('MODE_MISMATCH');
    expect(checkPluginModeConsistency('auto', baseManifest)?.code).toBe('MODE_MISMATCH');
  });

  it('local 目录 = shared：声明 shared 通过，声明 manual 拒绝', () => {
    expect(checkPluginModeConsistency('local', { ...baseManifest, modes: ['shared'] })).toBeNull();
    expect(checkPluginModeConsistency('local', { ...baseManifest, modes: ['manual'] })?.code).toBe('MODE_MISMATCH');
  });

  it('目录与 modes 交叉不一致 → MODE_MISMATCH（含 message 说明）', () => {
    const issue = checkPluginModeConsistency('manual', { ...baseManifest, modes: ['auto'] });
    expect(issue).not.toBeNull();
    expect(issue!.code).toBe('MODE_MISMATCH');
    expect(issue!.pluginId).toBe('novel.typography');
    expect(issue!.message).toContain('manual');
  });

  it('shared 目录声明单模式 → 拒绝', () => {
    expect(checkPluginModeConsistency('shared', { ...baseManifest, modes: ['manual'] })?.code).toBe('MODE_MISMATCH');
  });

  it('未知父目录名 → MODE_MISMATCH（非法布局）', () => {
    const issue = checkPluginModeConsistency('builtin', { ...baseManifest, modes: ['shared'] });
    expect(issue?.code).toBe('MODE_MISMATCH');
  });

  it('集成进 checkManifestPolicy：传 parentDirName 时执行模式门', () => {
    expect(checkManifestPolicy({ ...baseManifest, modes: ['auto'] }, { parentDirName: 'auto' })).toEqual([]);
    const issues = checkManifestPolicy({ ...baseManifest, modes: ['auto'] }, { parentDirName: 'manual' });
    expect(issues.map((i) => i.code)).toEqual(['MODE_MISMATCH']);
  });

  it('不传 parentDirName 时不做模式门（避免与显式调用重复报错）', () => {
    expect(checkManifestPolicy({ ...baseManifest, modes: ['auto'] })).toEqual([]);
  });
});
