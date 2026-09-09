// ============================================================
// 插件管理设置 Section —— 查看/开关插件 + 守护器（隔离箱）+ 全局依赖检查
//
// 数据源：GET /api/admin/plugins（列表 + 依赖分析 + 守护策略）
// 动作：POST /api/admin/plugins/:id/enable | /disable | /promote | /re-quarantine
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { Power, RefreshCw, AlertTriangle, Link2, ShieldCheck } from 'lucide-react';
import { apiClient } from '@/services/api/apiClient';
import { safeConfirm } from '@/utils/safeConfirm';

interface GuardianInfo {
  pluginId: string;
  state: 'quarantined' | 'trusted' | 'failed';
  since: number;
  sessions: number;
  errors: number;
  sessionErrors: number;
  invocations: number;
  lastError?: { at: number; where: string; message: string };
  promotedAt?: number;
}

interface GuardianPolicy {
  promoteAfterSessions: number;
  errorThreshold: number;
}

interface PluginItem {
  id: string;
  name: string;
  status: 'ok' | 'error' | 'skipped' | 'disabled';
  error?: string;
  order: number;
  enabled: boolean;
  permissions: string[];
  dependsOn: string[];
  requiredBy: string[];
  guardian?: GuardianInfo;
}

interface DepNode {
  id: string;
  name?: string;
  dependsOn: string[];
  requiredBy: string[];
  inject: string[];
}

interface DependencyAnalysis {
  nodes: DepNode[];
  missing: Array<{ id: string; missing: string[] }>;
  cycles: string[][];
  ok: boolean;
}

interface PluginListResponse {
  plugins: PluginItem[];
  deps: DependencyAnalysis;
  guardianPolicy?: GuardianPolicy;
}

const STATUS_META: Record<PluginItem['status'], { label: string; color: string }> = {
  ok: { label: '运行中', color: '#22c55e' },
  disabled: { label: '已禁用', color: '#94a3b8' },
  error: { label: '错误', color: '#ef4444' },
  skipped: { label: '跳过', color: '#f59e0b' },
};

const GUARDIAN_META: Record<GuardianInfo['state'], { label: string; color: string }> = {
  quarantined: { label: '隔离中', color: '#f59e0b' },
  trusted: { label: '已放行', color: '#22c55e' },
  failed: { label: '已熔断', color: '#ef4444' },
};

/** 守护操作按钮文案（quarantined → 放行；trusted/failed → 重置回隔离箱） */
const GUARDIAN_ACTION: Record<GuardianInfo['state'], { label: string; endpoint: string; confirm: string; tone: 'green' | 'amber' }> = {
  quarantined: {
    label: '立即放行',
    endpoint: 'promote',
    confirm: '放行该插件？放行后不再受隔离箱熔断约束（错误仍会计数展示）。',
    tone: 'green',
  },
  trusted: {
    label: '重新隔离',
    endpoint: 're-quarantine',
    confirm: '把该插件重新放回隔离箱？计数清零，重新进入观察期。',
    tone: 'amber',
  },
  failed: {
    label: '重置并重新隔离',
    endpoint: 're-quarantine',
    confirm: '重置该插件回隔离箱？若它已被熔断禁用，将清零计数并重新挂载启用。',
    tone: 'amber',
  },
};

export function PluginManagerSection() {
  const [data, setData] = useState<PluginListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const resp = await apiClient.get<PluginListResponse>('/admin/plugins');
      setData(resp);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载插件列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (p: PluginItem) => {
    if (p.enabled) {
      // 禁用前提示受影响的依赖方
      const dependents = p.requiredBy.filter((id) => data?.plugins.find((x) => x.id === id)?.enabled);
      if (dependents.length > 0) {
        const ok = safeConfirm(
          `禁用「${p.name}」后，依赖它的插件也将受影响：${dependents.join(', ')}。确定禁用？`,
        );
        if (!ok) return;
      }
    }
    setBusyId(p.id);
    setNotice('');
    try {
      await apiClient.post(`/admin/plugins/${encodeURIComponent(p.id)}/${p.enabled ? 'disable' : 'enable'}`);
      setNotice(`「${p.name}」已${p.enabled ? '禁用' : '启用'}`);
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '操作失败';
      setNotice(`操作失败: ${msg}`);
    } finally {
      setBusyId(null);
    }
  };

  const guardianAction = async (p: PluginItem) => {
    const g = p.guardian;
    if (!g) return;
    const action = GUARDIAN_ACTION[g.state];
    if (!safeConfirm(`「${p.name}」：${action.confirm}`)) return;
    setBusyId(p.id);
    setNotice('');
    try {
      await apiClient.post(`/admin/plugins/${encodeURIComponent(p.id)}/${action.endpoint}`);
      setNotice(`「${p.name}」${action.endpoint === 'promote' ? '已放行' : '已重置回隔离箱'}`);
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '操作失败';
      setNotice(`操作失败: ${msg}`);
    } finally {
      setBusyId(null);
    }
  };

  const enabledCount = data?.plugins.filter((p) => p.enabled).length ?? 0;
  const hasIssue = !!data && (!data.deps.ok || data.plugins.some((p) => p.status === 'error'));

  return (
    <div className="space-y-4">
      {/* 概览 */}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span style={{ color: 'hsl(var(--ink-light) / 0.7)' }}>
          共 <b className="text-base" style={{ color: 'hsl(var(--ink))' }}>{data?.plugins.length ?? 0}</b> 个插件
          ，启用 <b style={{ color: 'hsl(var(--ink))' }}>{enabledCount}</b> 个
        </span>
        {data && (
          <span
            className="px-2 py-0.5 rounded-full text-xs flex items-center gap-1"
            style={{ background: hasIssue ? 'rgba(239,68,68,0.12)' : 'rgba(34,197,94,0.12)', color: hasIssue ? '#ef4444' : '#22c55e' }}
          >
            <ShieldCheck size={12} />
            {data.deps.ok ? '依赖健康' : '依赖异常'}
          </span>
        )}
        {data?.guardianPolicy && (
          <span className="text-xs" style={{ color: 'hsl(var(--ink-light) / 0.6)' }}>
            隔离箱：连续 {data.guardianPolicy.promoteAfterSessions} 个会话零错误自动放行 · {data.guardianPolicy.errorThreshold} 次错误熔断
          </span>
        )}
        <button
          onClick={() => void load()}
          className="nm-btn-mist-soft px-2.5 py-1 rounded-md text-xs flex items-center gap-1"
          title="刷新"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          刷新
        </button>
      </div>

      {error && (
        <div className="text-sm p-3 rounded-md" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
          {error}（需要管理员权限）
        </div>
      )}

      {/* 依赖警告 */}
      {data && !data.deps.ok && (
        <div className="space-y-2">
          {data.deps.missing.map((m) => (
            <div key={m.id} className="text-sm p-3 rounded-md flex items-start gap-2"
              style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>
                插件 <b>{m.id}</b> 声明依赖 <b>{m.missing.join(', ')}</b>，但该插件不存在 → 已跳过
              </span>
            </div>
          ))}
          {data.deps.cycles.map((cycle, i) => (
            <div key={i} className="text-sm p-3 rounded-md flex items-start gap-2"
              style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b' }}>
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>
                循环依赖: <code className="font-mono">{cycle.join(' → ')}</code>
              </span>
            </div>
          ))}
        </div>
      )}

      {notice && (
        <div className="text-sm p-3 rounded-md" style={{ background: 'rgb(var(--glass-tint) / 0.4)', color: 'hsl(var(--ink-light))' }}>
          {notice}
        </div>
      )}

      {/* 插件列表 */}
      {loading && !data && <div className="text-sm opacity-60 py-6 text-center">加载中...</div>}

      {data && (
        <div className="space-y-2">
          {[...data.plugins].sort((a, b) => a.order - b.order).map((p) => {
            const meta = STATUS_META[p.status] ?? STATUS_META.skipped;
            const guardianMeta = p.guardian ? GUARDIAN_META[p.guardian.state] : null;
            const guardianActionDef = p.guardian ? GUARDIAN_ACTION[p.guardian.state] : null;
            return (
              <div key={p.id} className="rounded-lg border p-3"
                style={{ borderColor: 'hsl(var(--border) / 0.5)', opacity: p.enabled ? 1 : 0.62 }}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{p.name}</span>
                      <span className="text-xs font-mono" style={{ color: 'hsl(var(--ink-light) / 0.5)' }}>{p.id}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full"
                        style={{ background: `${meta.color}1f`, color: meta.color }}>
                        {meta.label}
                      </span>
                      {guardianMeta && (
                        <span className="text-xs px-2 py-0.5 rounded-full"
                          style={{ background: `${guardianMeta.color}1f`, color: guardianMeta.color }}>
                          {guardianMeta.label}
                        </span>
                      )}
                    </div>
                    {p.error && <div className="text-xs mt-1" style={{ color: '#ef4444' }}>{p.error}</div>}
                    {p.guardian && (
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs" style={{ color: 'hsl(var(--ink-light) / 0.6)' }}>
                        <span>会话 {p.guardian.sessions}</span>
                        <span>错误 {p.guardian.errors}</span>
                        <span>调用 {p.guardian.invocations}</span>
                      </div>
                    )}
                    {p.guardian?.lastError && (
                      <div className="text-xs mt-1" style={{ color: '#ef4444' }}>
                        最近错误 @ {p.guardian.lastError.where}: {p.guardian.lastError.message}
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs" style={{ color: 'hsl(var(--ink-light) / 0.6)' }}>
                      {p.permissions.length > 0 && (
                        <span className="flex items-center gap-1">
                          <ShieldCheck size={11} /> {p.permissions.length} 项权限
                        </span>
                      )}
                      {p.dependsOn.length > 0 && (
                        <span className="flex items-center gap-1">
                          <Link2 size={11} /> 依赖: {p.dependsOn.join(', ')}
                        </span>
                      )}
                      {p.requiredBy.length > 0 && (
                        <span className="flex items-center gap-1">
                          <Link2 size={11} className="rotate-180" /> 被依赖: {p.requiredBy.join(', ')}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
                    {guardianActionDef && (
                      <button
                        onClick={() => void guardianAction(p)}
                        disabled={busyId === p.id}
                        className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium"
                        style={{
                          background: guardianActionDef.tone === 'green' ? 'rgba(34,197,94,0.12)' : 'rgba(245,158,11,0.12)',
                          color: guardianActionDef.tone === 'green' ? '#22c55e' : '#f59e0b',
                          border: `0.5px solid ${guardianActionDef.tone === 'green' ? 'rgba(34,197,94,0.35)' : 'rgba(245,158,11,0.35)'}`,
                        }}
                        title={guardianActionDef.confirm}
                      >
                        {busyId === p.id ? '处理中...' : guardianActionDef.label}
                      </button>
                    )}
                    <button
                      onClick={() => void toggle(p)}
                      disabled={busyId === p.id}
                      className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium"
                      style={{
                        background: p.enabled ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.12)',
                        color: p.enabled ? '#ef4444' : '#22c55e',
                        border: `0.5px solid ${p.enabled ? 'rgba(239,68,68,0.35)' : 'rgba(34,197,94,0.35)'}`,
                      }}
                      title={p.enabled ? '禁用此插件（逆序清理其注册资源）' : '启用此插件（重新 apply）'}
                    >
                      <Power size={13} />
                      {busyId === p.id ? '处理中...' : p.enabled ? '禁用' : '启用'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
