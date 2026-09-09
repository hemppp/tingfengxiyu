// ============================================================
// 插件安装标准（novel-plugin-standard/1.0）纯函数测试
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  validateManifest,
  satisfiesMinVersion,
  checkManifestPolicy,
  localDirMatchesId,
  sortByDependencies,
  analyzeDependencies,
  type PluginManifest,
} from './index';

const baseManifest: PluginManifest = {
  id: 'novel.typography',
  name: '字体排版',
  version: '0.1.0',
  permissions: ['routes', 'db:global'],
  server: { inject: ['routes', 'db'] },
  web: { inject: ['projectPanels'] },
  serverEntry: './server/index.ts',
  webEntry: './web/index.tsx',
};

describe('G0 Manifest 门：validateManifest', () => {
  it('接受符合标准的 manifest（含 serverEntry/webEntry）', () => {
    const m = validateManifest(baseManifest);
    expect(m.id).toBe('novel.typography');
    expect(m.serverEntry).toBe('./server/index.ts');
    expect(m.webEntry).toBe('./web/index.tsx');
    expect(m.permissions).toEqual(['routes', 'db:global']);
  });

  it('拒绝非法 id（非反向域名）', () => {
    expect(() => validateManifest({ ...baseManifest, id: 'typography' })).toThrow(/manifest 校验失败/);
  });

  it('拒绝白名单外的权限', () => {
    expect(() => validateManifest({ ...baseManifest, permissions: ['routes', 'fs:root'] as never })).toThrow(/manifest 校验失败/);
  });

  it('拒绝白名单外的 web inject（假承诺防护）', () => {
    expect(() => validateManifest({ ...baseManifest, web: { inject: ['sidebar' as never] } })).toThrow(/manifest 校验失败/);
  });

  it('拒绝绝对路径入口', () => {
    expect(() => validateManifest({ ...baseManifest, serverEntry: 'C:\\evil\\index.ts' })).toThrow(/相对路径/);
    expect(() => validateManifest({ ...baseManifest, webEntry: '/etc/passwd' })).toThrow(/相对路径/);
  });

  it('拒绝 .. 穿越入口', () => {
    expect(() => validateManifest({ ...baseManifest, serverEntry: '../../system/index.ts' })).toThrow(/相对路径/);
    expect(() => validateManifest({ ...baseManifest, webEntry: '.\\..\\web\\index.tsx' })).toThrow(/相对路径/);
  });

  it('拒绝非 semver 版本号', () => {
    expect(() => validateManifest({ ...baseManifest, version: 'latest' })).toThrow(/semver/);
  });
});

describe('G3 版本门：satisfiesMinVersion', () => {
  it('主版本不足时返回 false', () => {
    expect(satisfiesMinVersion('0.1.0', '1.0.0')).toBe(false);
  });
  it('补丁版本满足时返回 true', () => {
    expect(satisfiesMinVersion('0.2.1', '0.2.0')).toBe(true);
  });
  it('相等时返回 true', () => {
    expect(satisfiesMinVersion('0.1.0', '0.1.0')).toBe(true);
  });
  it('缺失段按 0 处理', () => {
    expect(satisfiesMinVersion('0.2', '0.2.0')).toBe(true);
  });
});

describe('G4 依赖门：checkManifestPolicy', () => {
  it('无 minHostVersion 时版本门通过', () => {
    expect(checkManifestPolicy(baseManifest)).toEqual([]);
  });

  it('宿主版本低于要求时报 HOST_VERSION_MISMATCH', () => {
    const issues = checkManifestPolicy(
      { ...baseManifest, minHostVersion: '9.9.9' },
      { hostVersion: '0.1.0' },
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('HOST_VERSION_MISMATCH');
  });

  it('依赖不存在时报 DEP_MISSING', () => {
    const issues = checkManifestPolicy(
      { ...baseManifest, dependsOn: ['novel.ghost'] },
      { knownPluginIds: ['novel.projects', 'novel.auth'] },
    );
    expect(issues.map((i) => i.code)).toEqual(['DEP_MISSING']);
  });

  it('依赖被禁用时报 DEP_MISSING（提示先启用）', () => {
    const issues = checkManifestPolicy(
      { ...baseManifest, dependsOn: ['novel.projects'] },
      { knownPluginIds: ['novel.projects'], disabledPluginIds: ['novel.projects'] },
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('DEP_MISSING');
    expect(issues[0].message).toContain('已被禁用');
  });

  it('依赖存在且启用时通过', () => {
    const issues = checkManifestPolicy(
      { ...baseManifest, dependsOn: ['novel.projects'] },
      { knownPluginIds: ['novel.projects'] },
    );
    expect(issues).toEqual([]);
  });

  it('自依赖报 DEP_CYCLE', () => {
    const issues = checkManifestPolicy({ ...baseManifest, dependsOn: ['novel.typography'] });
    expect(issues.map((i) => i.code)).toEqual(['DEP_CYCLE']);
  });
});

describe('G2 身份门：localDirMatchesId', () => {
  it('允许完整 id 作目录名（AI create_plugin 形态）', () => {
    expect(localDirMatchesId('novel.typography', 'novel.typography')).toBe(true);
  });
  it('允许 id 尾段作目录名（手写插件形态）', () => {
    expect(localDirMatchesId('typography', 'novel.typography')).toBe(true);
  });
  it('拒绝无关联目录名', () => {
    expect(localDirMatchesId('typo', 'novel.typography')).toBe(false);
  });
});

describe('G4/G5 挂载期：sortByDependencies', () => {
  const services = new Set(['routes', 'db', 'ai', 'events']);

  it('按依赖排序：被依赖者先出队', () => {
    const items = [
      { id: 'a', inject: ['routes' as const], dependsOn: ['b'] },
      { id: 'b', inject: ['db' as const], dependsOn: [] },
    ];
    const { sorted, skipped, cycles } = sortByDependencies(items, services);
    expect(sorted.map((i) => i.id)).toEqual(['b', 'a']);
    expect(skipped).toHaveLength(0);
    expect(cycles).toHaveLength(0);
  });

  it('硬依赖缺失 → skipped 并给出缺失清单', () => {
    const items = [{ id: 'a', inject: [], dependsOn: ['novel.ghost'] }];
    const { sorted, skipped } = sortByDependencies(items, services);
    expect(sorted).toHaveLength(0);
    expect(skipped[0].missing).toEqual(['novel.ghost']);
  });

  it('服务缺失 → skipped（INJECT_MISSING 场景）', () => {
    const items = [{ id: 'a', inject: ['scheduler'], dependsOn: [] }];
    const { sorted, skipped } = sortByDependencies(items, new Set(['routes']));
    expect(sorted).toHaveLength(0);
    expect(skipped[0].missing).toEqual(['scheduler']);
  });

  it('循环依赖 → cycles 列出环路且不排序', () => {
    const items = [
      { id: 'a', inject: [], dependsOn: ['b'] },
      { id: 'b', inject: [], dependsOn: ['a'] },
    ];
    const { sorted, cycles } = sortByDependencies(items, services);
    expect(sorted).toHaveLength(0);
    expect(cycles.length).toBeGreaterThan(0);
  });
});

describe('依赖分析：analyzeDependencies', () => {
  it('requiredBy 反向索引正确且健康', () => {
    const analysis = analyzeDependencies([
      { id: 'novel.projects' },
      { id: 'novel.worldbuilding', dependsOn: ['novel.projects'] },
    ]);
    expect(analysis.ok).toBe(true);
    const projects = analysis.nodes.find((n) => n.id === 'novel.projects');
    expect(projects?.requiredBy).toEqual(['novel.worldbuilding']);
  });

  it('缺失依赖时 ok=false', () => {
    const analysis = analyzeDependencies([{ id: 'a', dependsOn: ['ghost'] }]);
    expect(analysis.ok).toBe(false);
    expect(analysis.missing[0].missing).toEqual(['ghost']);
  });
});
