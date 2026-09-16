// ============================================================
// 管理员后台 - 用户管理页面
//
// 功能：
// - 用户列表（用户名/昵称/管理员标识/创建时间/最近登录）
// - 重置任意用户密码
// - 删除用户（防自删/防删最后一个管理员）
// - 提升/取消管理员权限
// - 系统统计看板（用户数/项目数/章节数）
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { InkBackButton } from '@/components/ui/InkBackButton';
import {
  Shield,
  KeyRound,
  Trash2,
  Crown,
  UserPlus,
  Loader2,
  AlertCircle,
  Users,
  FolderOpen,
  FileText,
} from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { adminApi, type AdminUser, type AdminStats } from '@/services/api/authApi';
import { safeConfirm } from '@/utils/safeConfirm';

export function AdminPage() {
  const navigate = useNavigate();
  const { user: currentUser } = useAuthStore();

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // 重置密码的弹窗状态
  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [usersData, statsData] = await Promise.all([
        adminApi.listUsers(),
        adminApi.getStats(),
      ]);
      // 按创建时间倒序
      setUsers(usersData.sort((a, b) => b.createdAt - a.createdAt));
      setStats(statsData);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // 非管理员直接踢回首页
    if (currentUser && !currentUser.isAdmin) {
      navigate('/', { replace: true });
      return;
    }
    loadData();
  }, [currentUser, navigate, loadData]);

  // ---- 重置密码 ----
  const handleResetPassword = async () => {
    if (!resetTarget) return;
    if (newPassword.length < 6) {
      setError('密码至少 6 个字符');
      return;
    }
    setActionLoading(true);
    setError('');
    try {
      await adminApi.resetUserPassword(resetTarget.id, newPassword);
      setResetTarget(null);
      setNewPassword('');
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : '重置失败');
    } finally {
      setActionLoading(false);
    }
  };

  // ---- 删除用户 ----
  const handleDeleteUser = async (user: AdminUser) => {
    if (user.id === currentUser?.id) {
      setError('不能删除当前登录的管理员账号');
      return;
    }
    const ok = await safeConfirm(
      `确认删除用户「${user.username}」？\n该用户的关联项目数据会保留，但用户账号将无法登录。`,
    );
    if (!ok) return;
    setActionLoading(true);
    setError('');
    try {
      await adminApi.deleteUser(user.id);
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败');
    } finally {
      setActionLoading(false);
    }
  };

  // ---- 切换管理员权限 ----
  const handleToggleAdmin = async (user: AdminUser) => {
    const action = user.isAdmin ? '取消' : '授予';
    const ok = await safeConfirm(
      `确认${action}用户「${user.username}」的管理员权限？`,
    );
    if (!ok) return;
    setActionLoading(true);
    setError('');
    try {
      await adminApi.setUserAdmin(user.id, !user.isAdmin);
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : '设置失败');
    } finally {
      setActionLoading(false);
    }
  };

  // ---- 工具 ----
  const formatDate = (ts?: number) => {
    if (!ts) return '—';
    return new Date(ts).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (!currentUser?.isAdmin) {
    return null; // useEffect 会重定向
  }

  return (
    <div className="min-h-screen" style={{ fontFamily: "'Noto Serif SC', serif" }}>
      {/* 顶栏 */}
      <header
        className="sticky top-0 z-10 backdrop-blur-xl"
        style={{
          background: 'rgb(var(--glass-tint) / 0.7)',
          borderBottom: '1px solid hsl(var(--border) / 0.3)',
        }}
      >
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <InkBackButton onClick={() => navigate('/')} size={18} label="返回首页" />
            <Shield size={20} style={{ color: 'hsl(var(--mountain-cyan))' }} />
            <h1
              className="text-[20px] font-semibold"
              style={{ color: 'hsl(var(--ink))', letterSpacing: '0.02em' }}
            >
              管理员后台
            </h1>
          </div>
          <button
            onClick={() => navigate('/')}
            className="nm-btn-outline-pill text-[12px]"
          >
            返回写作
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* 统计卡片 */}
        {stats && (
          <div className="grid grid-cols-3 gap-4 mb-8">
            <StatCard icon={<Users size={18} />} label="用户数" value={stats.users} />
            <StatCard icon={<FolderOpen size={18} />} label="项目数" value={stats.projects} />
            <StatCard icon={<FileText size={18} />} label="章节数" value={stats.chapters} />
          </div>
        )}

        {/* 错误提示 */}
        {error && (
          <div
            className="mb-4 px-4 py-3 rounded-xl flex items-start gap-2"
            style={{
              color: 'hsl(var(--vermilion))',
              background: 'hsl(var(--vermilion) / 0.08)',
              border: '0.5px solid hsl(var(--vermilion) / 0.2)',
            }}
          >
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span className="text-[13px]">{error}</span>
          </div>
        )}

        {/* 用户列表 */}
        <div
          className="rounded-2xl overflow-hidden"
          style={{
            background: 'rgb(var(--glass-tint) / 0.5)',
            backdropFilter: 'blur(16px)',
            border: '1px solid hsl(var(--border) / 0.3)',
          }}
        >
          <div
            className="px-5 py-3 flex items-center justify-between"
            style={{ borderBottom: '1px solid hsl(var(--border) / 0.3)' }}
          >
            <h2
              className="text-[15px] font-semibold"
              style={{ color: 'hsl(var(--ink))' }}
            >
              用户管理
            </h2>
            <button
              onClick={() => navigate('/register')}
              className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-lg transition-colors hover:bg-black/5"
              style={{ color: 'hsl(var(--mountain-cyan))' }}
            >
              <UserPlus size={13} />
              <span>新增用户</span>
            </button>
          </div>

          {loading ? (
            <div className="px-5 py-12 flex items-center justify-center gap-2 text-[13px]" style={{ color: 'hsl(var(--ink-light))' }}>
              <Loader2 size={14} className="animate-spin" />
              加载中...
            </div>
          ) : users.length === 0 ? (
            <div className="px-5 py-12 text-center text-[13px]" style={{ color: 'hsl(var(--ink-light))' }}>
              暂无用户
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr style={{ borderBottom: '1px solid hsl(var(--border) / 0.2)' }}>
                    <Th>用户名</Th>
                    <Th>显示名称</Th>
                    <Th>角色</Th>
                    <Th>创建时间</Th>
                    <Th>最近登录</Th>
                    <Th align="right">操作</Th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr
                      key={u.id}
                      style={{ borderBottom: '1px solid hsl(var(--border) / 0.15)' }}
                    >
                      <Td>
                        <span className="font-medium" style={{ color: 'hsl(var(--ink))' }}>
                          {u.username}
                        </span>
                        {u.id === currentUser?.id && (
                          <span
                            className="ml-2 text-[11px] px-1.5 py-0.5 rounded"
                            style={{
                              background: 'hsl(var(--mountain-cyan) / 0.12)',
                              color: 'hsl(var(--mountain-cyan))',
                            }}
                          >
                            你
                          </span>
                        )}
                      </Td>
                      <Td>{u.displayName}</Td>
                      <Td>
                        {u.isAdmin ? (
                          <span
                            className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full"
                            style={{
                              background: 'hsl(var(--ochre) / 0.12)',
                              color: 'hsl(var(--ochre))',
                            }}
                          >
                            <Crown size={10} />
                            管理员
                          </span>
                        ) : (
                          <span style={{ color: 'hsl(var(--ink-light))' }}>普通用户</span>
                        )}
                      </Td>
                      <Td style={{ color: 'hsl(var(--ink-light))' }}>{formatDate(u.createdAt)}</Td>
                      <Td style={{ color: 'hsl(var(--ink-light))' }}>{formatDate(u.lastLoginAt)}</Td>
                      <Td align="right">
                        <div className="inline-flex items-center gap-1">
                          <ActionButton
                            icon={<KeyRound size={12} />}
                            label="重置密码"
                            onClick={() => {
                              setResetTarget(u);
                              setNewPassword('');
                              setError('');
                            }}
                            disabled={actionLoading}
                          />
                          <ActionButton
                            icon={<Crown size={12} />}
                            label={u.isAdmin ? '取消管理员' : '设为管理员'}
                            onClick={() => handleToggleAdmin(u)}
                            disabled={actionLoading || u.id === currentUser?.id}
                            active={u.isAdmin}
                          />
                          <ActionButton
                            icon={<Trash2 size={12} />}
                            label="删除"
                            onClick={() => handleDeleteUser(u)}
                            disabled={actionLoading || u.id === currentUser?.id}
                            danger
                          />
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {/* 重置密码弹窗 */}
      {resetTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'hsl(var(--ink-deep) / 0.4)', backdropFilter: 'blur(4px)' }}
          onClick={() => setResetTarget(null)}
        >
          <div
            className="w-full max-w-[400px] mx-4 rounded-2xl p-6"
            style={{
              background: 'rgb(var(--glass-tint) / 0.95)',
              backdropFilter: 'blur(24px) saturate(180%)',
              border: '1px solid hsl(var(--border) / 0.4)',
              boxShadow: '0 12px 40px hsl(var(--ink-deep) / 0.2)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-4">
              <KeyRound size={16} style={{ color: 'hsl(var(--mountain-cyan))' }} />
              <h3 className="text-[16px] font-semibold" style={{ color: 'hsl(var(--ink))' }}>
                重置密码
              </h3>
            </div>
            <p className="text-[12px] mb-4" style={{ color: 'hsl(var(--ink-soft))' }}>
              将为用户「<span style={{ color: 'hsl(var(--ink))', fontWeight: 500 }}>{resetTarget.username}</span>」
              设置新密码，旧密码将立即失效。
            </p>
            <input
              type="password"
              className="nm-input mb-4"
              placeholder="输入新密码（至少 6 位）"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoFocus
              autoComplete="new-password"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setResetTarget(null)}
                className="nm-btn-outline-pill flex-1 text-[13px]"
                disabled={actionLoading}
              >
                取消
              </button>
              <button
                onClick={handleResetPassword}
                disabled={actionLoading || newPassword.length < 6}
                className="nm-btn-primary-pill flex-1 text-[13px]"
              >
                {actionLoading ? '提交中...' : '确认重置'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- 子组件 ----

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div
      className="rounded-2xl p-5"
      style={{
        background: 'rgb(var(--glass-tint) / 0.5)',
        backdropFilter: 'blur(16px)',
        border: '1px solid hsl(var(--border) / 0.3)',
      }}
    >
      <div className="flex items-center gap-2 mb-2" style={{ color: 'hsl(var(--ink-light))' }}>
        {icon}
        <span className="text-[12px]">{label}</span>
      </div>
      <div
        className="text-[28px] font-semibold tabular-nums"
        style={{ color: 'hsl(var(--ink))' }}
      >
        {value}
      </div>
    </div>
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      className="px-4 py-3 text-[11px] font-medium uppercase tracking-wider"
      style={{
        color: 'hsl(var(--ink-light))',
        textAlign: align,
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = 'left',
  style,
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
  style?: React.CSSProperties;
}) {
  return (
    <td className="px-4 py-3" style={{ textAlign: align, ...style }}>
      {children}
    </td>
  );
}

function ActionButton({
  icon,
  label,
  onClick,
  disabled,
  danger,
  active,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] transition-colors disabled:opacity-30 disabled:cursor-not-allowed hover:bg-black/5"
      style={{
        color: danger
          ? 'hsl(var(--vermilion))'
          : active
            ? 'hsl(var(--ochre))'
            : 'hsl(var(--ink-soft))',
      }}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
