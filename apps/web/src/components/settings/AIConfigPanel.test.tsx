// ============================================================
// AIConfigPanel.test.tsx —— AI 设置面板的挂载自证（kernel）
//
// 为什么需要它：数据层已有 27 个单测（services/api/__tests__/aiConfigService.test.ts），
// 但那只证明「纯函数算得对」。面板本身是**唯一**把「设置页 → AI 设置」这条链补上的
// 一环，若它挂载即抛（hooks 顺序、字段未定义、导出名不符），页面仍是一片空白 ——
// 这正是本次要修的原始缺陷形态，故必须有运行时证据。
//
// 口径：只替身 apiClient（不外呼网络），服务层与面板走真实代码路径。
//   断言 4 件事：① 挂载即读配置并回填（且不误报「有未保存的改动」）
//              ② 改动 → 脏态 → 「保存并测试连接」文案随之变化
//              ③ 点保存发出的**完整请求体**（三态语义在真实交互下的结果）
//              ④ 读取失败 → 错误态 → 「重试」能恢复
// ============================================================

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock('@/services/api/apiClient', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    apiClient: {
      get: mocks.get,
      post: mocks.post,
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

import { ApiError } from '@/services/api/apiClient';
import { AIConfigPanel } from '@/components/settings/AIConfigPanel';
import type { AIConfigDTO } from '@/services/api/aiConfigService';

function cfg(over: Partial<AIConfigDTO> = {}): AIConfigDTO {
  return {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    provider: 'openai',
    apiKeyConfigured: true,
    apiKeyHint: '***abcd',
    _source: 'user_db',
    ...over,
  };
}

describe('AIConfigPanel', () => {
  it('挂载即读 /ai/config 并回填（来源 user_db 时无来源提示，且不显示脏态）', async () => {
    mocks.get.mockResolvedValue(cfg({ temperature: 0.7 }));

    render(<AIConfigPanel />);

    // 加载态先行，随后进入就绪态
    await screen.findByText('模型提供商');
    expect(mocks.get).toHaveBeenCalledWith('/ai/config', undefined, { silent: true });

    // 回填：baseUrl / model / 采样参数（0 也算有值，故这里用 0.7 验证数字回填）
    expect(screen.getByDisplayValue('https://api.openai.com/v1')).toBeInTheDocument();
    expect(screen.getByDisplayValue('gpt-4o-mini')).toBeInTheDocument();
    expect(screen.getByDisplayValue('0.7')).toBeInTheDocument();

    // 刚加载完不算脏
    expect(screen.queryByText('有未保存的改动')).toBeNull();
    expect(screen.getByRole('button', { name: /^测试连接$/ })).toBeInTheDocument();
  });

  it('改动 → 脏态 → 文案变「保存并测试连接」；点保存发出完整请求体（不含密钥、无基线时不发采样字段）', async () => {
    const user = userEvent.setup();
    mocks.get.mockResolvedValue(cfg());
    mocks.post.mockResolvedValue(cfg({ model: 'gpt-4o-minix' }));

    render(<AIConfigPanel />);
    await screen.findByText('模型提供商');

    const modelInput = screen.getByDisplayValue('gpt-4o-mini');
    await user.type(modelInput, 'x');

    // 两个 section 各自提示脏态
    expect(screen.getAllByText('有未保存的改动')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /保存并测试连接/ })).toBeInTheDocument();

    // 两个 section 各有一颗「保存」，点第一颗即可
    const saveButtons = screen.getAllByRole('button', { name: /^保存$/ });
    expect(saveButtons).toHaveLength(2);
    await user.click(saveButtons[0]!);

    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
    const [path, body, options] = mocks.post.mock.calls[0]!;
    expect(path).toBe('/ai/config');
    // 三态收口：provider/baseUrl/model 恒提交；apiKey 空 ⇒ 不出现；采样无基线 ⇒ 省略（≠ null、≠ 0）
    expect(body).toEqual({
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-minix',
    });
    expect(options).toEqual({ silent: true, timeoutMs: 20000 });

    await screen.findByText('已保存');
    // 保存成功后回填服务端返回值 ⇒ 脏态消失、按钮文案复原
    await waitFor(() => expect(screen.queryByText('有未保存的改动')).toBeNull());
    expect(screen.getByRole('button', { name: /^测试连接$/ })).toBeInTheDocument();
  });

  it('来源非 user_db 且未配置密钥时给出两条黄条提示', async () => {
    mocks.get.mockResolvedValue(cfg({
      _source: 'server_env',
      apiKeyConfigured: false,
      apiKeyHint: '',
    }));

    render(<AIConfigPanel />);

    await screen.findByText(/当前使用服务端环境变量里的默认配置/);
    expect(screen.getByText(/未配置 API Key/)).toBeInTheDocument();
  });

  it('读取失败 → 错误态展示人话错误；点重试可恢复', async () => {
    const user = userEvent.setup();
    mocks.get
      .mockRejectedValueOnce(new ApiError(0, 'TIMEOUT', 'timeout'))
      .mockResolvedValueOnce(cfg());

    render(<AIConfigPanel />);

    await screen.findByText(/请求超时：模型服务响应太慢/);
    expect(screen.queryByText('模型提供商')).toBeNull();

    await user.click(screen.getByRole('button', { name: /重试/ }));

    await screen.findByText('模型提供商');
    expect(screen.getByDisplayValue('gpt-4o-mini')).toBeInTheDocument();
  });
});
