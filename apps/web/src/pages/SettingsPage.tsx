import { useState, useRef, useEffect, useCallback } from 'react';
import { useStatsStore } from '@/stores';
import { Lock, Trash2, Settings2, Palette, Bot, ShieldCheck, Plug, Keyboard, MonitorUp } from 'lucide-react';
import { InkBackButton } from '@/components/ui/InkBackButton';
import { AppearancePanel } from '@/components/settings/AppearancePanel';
import { safeConfirm } from '@/utils/safeConfirm';
import { useNavigate } from 'react-router-dom';
import { PATHS } from '@/routes/paths';
import { AIConfigPanel } from '@/components/settings/AIConfigPanel';
import { PluginManagerSection } from '@/components/settings/PluginManagerSection';
import { PluginSettingsSections } from '@/components/settings/PluginSettingsSections';
import { UpdateSection } from '@/components/settings/UpdateSection';
import type { ReactNode } from 'react';
import {
  saveEncrypted,
  loadEncrypted,
  deleteEncrypted,
  listEncryptedKeys,
} from '@/services/security/encryptionService';

/** 设置分类（栏目） */
type CategoryKey = 'general' | 'appearance' | 'ai' | 'security' | 'plugins' | 'updates';

const CATEGORIES: Array<{ key: CategoryKey; label: string; icon: ReactNode; desc: string }> = [
  { key: 'general', label: '通用', icon: <Settings2 size={15} />, desc: '每日目标 / 自动保存 / 快捷键' },
  { key: 'appearance', label: '外观', icon: <Palette size={15} />, desc: '主题换肤 / 明暗' },
  { key: 'ai', label: 'AI 设置', icon: <Bot size={15} />, desc: '模型提供商与写作助手参数' },
  { key: 'security', label: '安全', icon: <ShieldCheck size={15} />, desc: '本地加密存储' },
  { key: 'plugins', label: '插件', icon: <Plug size={15} />, desc: '插件列表 / 开关 / 依赖检查' },
  { key: 'updates', label: '更新', icon: <MonitorUp size={15} />, desc: '应用与插件的远程更新' },
];

export function SettingsPage() {
  const navigate = useNavigate();
  const [category, setCategory] = useState<CategoryKey>('general');
  const dailyGoal = useStatsStore((s) => s.dailyGoal);
  const setDailyGoal = useStatsStore((s) => s.setDailyGoal);
  const [autoSaveInterval, setAutoSaveInterval] = useState(30);

  const handleBack = useCallback(() => {
    // navigate(-1) 依赖浏览器历史栈，刷新页面或直接访问时无历史
    // 用 window.history.length 做启发式判断：>2 说明有 SPA 内部导航历史
    if (window.history.length > 2) {
      navigate(-1);
    } else {
      navigate(PATHS.bookshelf, { replace: true });
    }
  }, [navigate]);

  const [encryptionPassword, setEncryptionPassword] = useState('');
  const [encryptionStatus, setEncryptionStatus] = useState('');
  const [savedKeys, setSavedKeys] = useState<string[]>([]);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleTestEncryption = async () => {
    if (!encryptionPassword) {
      setEncryptionStatus('请输入密码');
      return;
    }
    try {
      const testData = '测试';
      await saveEncrypted('test', testData, encryptionPassword);
      const loaded = await loadEncrypted('test', encryptionPassword);
      if (!mountedRef.current) return;
      if (loaded === testData) {
        setEncryptionStatus('处理中...');
        const keys = await listEncryptedKeys();
        if (!mountedRef.current) return;
        setSavedKeys(keys);
      } else {
        setEncryptionStatus('验证失败');
      }
    } catch (_e) {
      if (!mountedRef.current) return;
      setEncryptionStatus('处理中...');
    }
  };

  const handleClearEncryption = async () => {
    if (!safeConfirm('确定清除所有加密设置？')) return;
    try {
      const keys = await listEncryptedKeys();
      for (const key of keys) {
        await deleteEncrypted(key);
      }
      if (!mountedRef.current) return;
      setSavedKeys([]);
      setEncryptionStatus('完成');
    } catch (_e) {
      if (!mountedRef.current) return;
      setEncryptionStatus('处理中...');
    }
  };

  return (
    <div className="h-full overflow-y-auto" style={{ background: 'transparent' }}>
      <div className="max-w-5xl mx-auto px-8 py-10">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <InkBackButton onClick={handleBack} size={18} label="返回项目页" />
          <h1
            className="font-serif"
            style={{
              fontSize: '2rem',
              fontWeight: 600,
              color: 'hsl(var(--ink))',
              letterSpacing: '-0.02em',
            }}
          >
            设置
          </h1>
        </div>

        <div className="flex gap-6">
          {/* ── 左侧栏目导航 ── */}
          <nav className="w-44 shrink-0 space-y-1">
            {CATEGORIES.map((c) => (
              <button
                key={c.key}
                onClick={() => setCategory(c.key)}
                className="w-full text-left px-3 py-2.5 rounded-lg transition-colors"
                style={{
                  background: category === c.key ? 'rgb(var(--glass-tint) / 0.55)' : 'transparent',
                  border: category === c.key ? '0.5px solid hsl(var(--border) / 0.6)' : '0.5px solid transparent',
                }}
              >
                <div className="flex items-center gap-2 text-sm font-medium" style={{ color: category === c.key ? 'hsl(var(--ink))' : 'hsl(var(--ink-light) / 0.75)' }}>
                  {c.icon}
                  {c.label}
                </div>
                <div className="text-[11px] mt-0.5 pl-[23px]" style={{ color: 'hsl(var(--ink-light) / 0.45)' }}>
                  {c.desc}
                </div>
              </button>
            ))}
          </nav>

          {/* ── 右侧内容区（按栏目渲染） ── */}
          <div className="flex-1 min-w-0 space-y-6">
            {category === 'general' && (
              <>
                {/* 写作设置 */}
                <section className="nm-card p-6">
                  <h2 className="nm-section-title">写作目标</h2>
                  <div className="space-y-5">
                    <div>
                      <label className="nm-label">每日目标</label>
                      <div className="flex items-center gap-2 mt-1.5">
                        <input
                          type="number"
                          value={dailyGoal}
                          onChange={(e) => setDailyGoal(Number(e.target.value))}
                          min={0}
                          className="nm-input-sm w-32 px-3 py-1.5 text-sm"
                        />
                        <span className="text-sm" style={{ color: 'hsl(var(--ink-light) / 0.6)' }}>
                          字
                        </span>
                      </div>
                    </div>
                    <div>
                      <label className="nm-label">自动保存间隔</label>
                      <div className="flex items-center gap-2 mt-1.5">
                        <input
                          type="number"
                          value={autoSaveInterval}
                          onChange={(e) => setAutoSaveInterval(Number(e.target.value))}
                          min={10}
                          max={300}
                          className="nm-input-sm w-24 px-3 py-1.5 text-sm"
                        />
                        <span className="text-sm" style={{ color: 'hsl(var(--ink-light) / 0.6)' }}>
                          秒
                        </span>
                      </div>
                    </div>
                  </div>
                </section>

                {/* Shortcuts Section */}
                <section className="nm-card p-6">
                  <h2 className="nm-section-title flex items-center gap-2">
                    <Keyboard size={14} />
                    快捷键
                  </h2>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    {[
                      ['Ctrl+K', '打开命令面板'],
                      ['Ctrl+S', '保存'],
                      ['Tab', '切换到 AI 设置'],
                      ['Esc', '关闭'],
                      ['Alt+1~6', '切换侧栏'],
                      ['Alt+0', '隐藏面板'],
                    ].map(([key, desc]) => (
                      <div key={key} className="flex items-center gap-2.5 py-1.5">
                        <kbd
                          className="px-2 py-0.5 rounded text-xs font-mono"
                          style={{
                            background: 'rgb(var(--glass-tint) / 0.5)',
                            border: '0.5px solid hsl(var(--border) / 0.6)',
                            color: 'hsl(var(--ink-light))',
                          }}
                        >
                          {key}
                        </kbd>
                        <span style={{ color: 'hsl(var(--ink-light) / 0.7)' }}>{desc}</span>
                      </div>
                    ))}
                  </div>
                </section>
              </>
            )}

            {category === 'appearance' && <AppearancePanel />}

            {category === 'ai' && (
              <section className="nm-card p-6">
                <h2 className="nm-section-title">AI 设置</h2>
                <AIConfigPanel />
              </section>
            )}

            {category === 'security' && (
              <section className="nm-card p-6">
                <h2
                  className="nm-section-title flex items-center gap-2"
                  style={{ marginBottom: '0.5rem' }}
                >
                  <Lock size={14} />
                  本地加密存储
                </h2>
                <p className="text-sm mb-5" style={{ color: 'hsl(var(--ink-light) / 0.65)' }}>
                  使用 AES-256-GCM 加密存储于 IndexedDB 的本地设置加密功能
                </p>

                <div className="space-y-4">
                  <div>
                    <label className="nm-label">加密密码</label>
                    <input
                      type="password"
                      value={encryptionPassword}
                      onChange={(e) => setEncryptionPassword(e.target.value)}
                      className="nm-input-sm w-full mt-1.5 px-3 py-2 text-sm"
                      placeholder="请输入加密密码"
                    />
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={handleTestEncryption}
                      className="nm-btn-mist-primary px-4 py-1.5 text-sm rounded-md font-medium flex items-center gap-1.5"
                    >
                      测试加密
                    </button>
                    <button
                      onClick={handleClearEncryption}
                      className="nm-btn-danger-outline px-4 py-1.5 text-sm rounded-md font-medium flex items-center gap-1.5"
                    >
                      <Trash2 size={14} /> 清除
                    </button>
                  </div>

                  {encryptionStatus && (
                    <div
                      className="text-sm p-3 rounded-md"
                      style={{
                        background: 'rgb(var(--glass-tint) / 0.4)',
                        border: '0.5px solid hsl(var(--border) / 0.5)',
                        color: 'hsl(var(--ink-light))',
                      }}
                    >
                      {encryptionStatus}
                    </div>
                  )}

                  {savedKeys.length > 0 && (
                    <div className="text-xs" style={{ color: 'hsl(var(--ink-light) / 0.5)' }}>
                      已保存 {savedKeys.length} 项加密数据
                    </div>
                  )}
                </div>
              </section>
            )}

            {category === 'plugins' && (
              <section className="nm-card p-6">
                <h2 className="nm-section-title flex items-center gap-2">
                  <Plug size={14} />
                  插件管理
                </h2>
                <p className="text-sm mb-5" style={{ color: 'hsl(var(--ink-light) / 0.65)' }}>
                  查看已挂载插件、运行时开关（禁用状态持久化）、检查全局互相依赖。
                  插件的主功能界面在工作台面板栏打开；注册了设置区的插件会在下方追加自己的配置卡片。
                </p>
                <PluginManagerSection />
              </section>
            )}

            {category === 'updates' && (
              <section className="nm-card p-6">
                <h2 className="nm-section-title flex items-center gap-2">
                  <MonitorUp size={14} />
                  远程更新
                </h2>
                <p className="text-sm mb-5" style={{ color: 'hsl(var(--ink-light) / 0.65)' }}>
                  配置更新源后在线更新应用本体与插件（仅桌面端；浏览器模式可预览界面）
                </p>
                <UpdateSection />
              </section>
            )}

            {/* 插件注册的设置区：按 category 归入对应栏目，排在原生区块之后 */}
            <PluginSettingsSections category={category} />
          </div>
        </div>
      </div>
    </div>
  );
}
