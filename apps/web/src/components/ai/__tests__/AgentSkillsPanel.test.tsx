/**
 * @fileoverview AgentSkillsPanel —— 「智能体 Skills」面板
 *
 * 用户口径（2026-09-13）在这里逐条落成断言：
 *   · 点击后展示**当前全部智能体**（分组 + 各自的技能计数）
 *   · 点某个智能体 → 看到**左关右开**的开关
 *   · 技能库只做**安装与删除**，内部按「智能体 skills」/「agent skills」两类分开
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { AgentSkillsPanel } from '../AgentSkillsPanel';
import type { LibrarySkill, SkillTargetView } from '@/services/ai/skillLibrary';

const mockFetchTargets = vi.fn();
const mockFetchTargetSkills = vi.fn();
const mockFetchLibrary = vi.fn();
const mockToggle = vi.fn();
const mockToggleAll = vi.fn();
const mockInstall = vi.fn();
const mockRemove = vi.fn();
const mockToast = vi.fn();

vi.mock('@/services/ai/skillLibrary', () => ({
  fetchSkillTargets: (...a: unknown[]) => mockFetchTargets(...a),
  fetchTargetSkills: (...a: unknown[]) => mockFetchTargetSkills(...a),
  fetchSkillLibrary: (...a: unknown[]) => mockFetchLibrary(...a),
  toggleAgentSkill: (...a: unknown[]) => mockToggle(...a),
  toggleAllAgentSkills: (...a: unknown[]) => mockToggleAll(...a),
  installSkillOnLibrary: (...a: unknown[]) => mockInstall(...a),
  removeSkillFromLibrary: (...a: unknown[]) => mockRemove(...a),
}));

vi.mock('@/utils/errors', () => ({
  dispatchToastEvent: (...a: unknown[]) => mockToast(...a),
}));

const T = (over: Partial<SkillTargetView>): SkillTargetView => ({
  id: 'writer', name: '写作官', kind: 'agent', short: '写', color: '#0F6E56',
  description: '按本章结论落笔成文', group: '写作流水线', source: 'core', total: 2, enabled: 1,
  ...over,
});

const TARGETS: SkillTargetView[] = [
  T({ id: 'chat', name: '对话智能体', kind: 'assistant', short: '我', group: '对话', total: 0, enabled: 0 }),
  T({}),
  T({ id: 'plot-designer', name: '剧情设计师', short: '剧', total: 0, enabled: 0 }),
];

const libSkill = (over: Partial<LibrarySkill>): LibrarySkill => ({
  id: 'worldbuilder', name: '世界观顾问', description: '核对地点物品设定',
  color: '#10b981', iconKey: 'worldbuilder',
  category: 'agent', ownerAgent: 'writer', ownerAgentName: '写作官',
  systemPrompt: 'x', contextKeys: [], source: 'builtin', createdAt: 0, updatedAt: 0,
  ...over,
});

beforeEach(() => {
  mockFetchTargets.mockReset().mockResolvedValue({ targets: TARGETS });
  mockFetchTargetSkills.mockReset().mockResolvedValue({
    target: T({}),
    skills: [
      { ...libSkill({ id: 'worldbuilder', name: '世界观顾问' }), enabled: true, configured: true },
      { ...libSkill({ id: 'rhythm-doctor', name: '节奏医生' }), enabled: false, configured: false },
    ],
  });
  mockFetchLibrary.mockReset().mockResolvedValue({
    skills: [libSkill({}), libSkill({ id: 'assistant-x', name: '对话助手技能', category: 'assistant', ownerAgent: null, ownerAgentName: null })],
    byCategory: {
      assistant: [libSkill({ id: 'assistant-x', name: '对话助手技能', category: 'assistant', ownerAgent: null, ownerAgentName: null })],
      agent: [libSkill({})],
    },
    orphans: [],
  });
  mockToggle.mockReset().mockResolvedValue({ agentId: 'writer', skillId: 'rhythm-doctor', enabled: true });
  mockToggleAll.mockReset().mockResolvedValue({ agentId: 'writer', enabled: true, count: 2 });
  mockInstall.mockReset().mockResolvedValue(libSkill({ id: 'new-skill', name: '新技能' }));
  mockRemove.mockReset().mockResolvedValue({ id: 'worldbuilder', removed: true });
  mockToast.mockReset();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('AgentSkillsPanel', () => {
  it('按智能体页签展示**全部**智能体，分组并给出各自的技能计数', async () => {
    render(<AgentSkillsPanel />);
    expect(await screen.findByText('对话智能体')).toBeInTheDocument();
    expect(screen.getByText('写作官')).toBeInTheDocument();
    expect(screen.getByText('剧情设计师')).toBeInTheDocument();
    // 分组标题来自后端清单，不在前端另写一份
    expect(screen.getByText('对话')).toBeInTheDocument();
    expect(screen.getByText('写作流水线')).toBeInTheDocument();
    // 计数：写作官 1/2
    expect(screen.getByText('1/2')).toBeInTheDocument();
  });

  it('★ 点某个智能体后下钻，看到技能与开关，且能返回清单', async () => {
    render(<AgentSkillsPanel />);
    fireEvent.click(await screen.findByText('写作官'));

    expect(await screen.findByText('世界观顾问')).toBeInTheDocument();
    expect(screen.getByText('节奏医生')).toBeInTheDocument();
    // 两条技能各有一个左关右开开关
    expect(screen.getAllByRole('switch')).toHaveLength(2);
    expect(screen.getByRole('switch', { name: /世界观顾问 技能开关/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: /节奏医生 技能开关/ })).toHaveAttribute('aria-checked', 'false');
    // 计数只属于这个智能体
    expect(mockFetchTargetSkills).toHaveBeenCalledWith('writer');

    fireEvent.click(screen.getByText('全部智能体'));
    expect(await screen.findByText('剧情设计师')).toBeInTheDocument();
  });

  it('拨动开关 → 调 toggleAgentSkill，并以服务端结果为准更新界面', async () => {
    render(<AgentSkillsPanel />);
    fireEvent.click(await screen.findByText('写作官'));
    const sw = await screen.findByRole('switch', { name: /节奏医生 技能开关/ });
    fireEvent.click(sw);
    await waitFor(() => expect(mockToggle).toHaveBeenCalledWith('writer', 'rhythm-doctor', true));
    await waitFor(() => expect(screen.getByRole('switch', { name: /节奏医生 技能开关/ })).toHaveAttribute('aria-checked', 'true'));
  });

  it('技能库页签：按「智能体 skills」「agent skills」两类分开列出', async () => {
    render(<AgentSkillsPanel />);
    fireEvent.click(await screen.findByRole('tab', { name: '技能库' }));
    expect(await screen.findByText('智能体 skills')).toBeInTheDocument();
    expect(screen.getByText('agent skills')).toBeInTheDocument();
    // 两类各自的条目
    expect(screen.getByText('对话助手技能')).toBeInTheDocument();
    expect(screen.getByText('世界观顾问')).toBeInTheDocument();
  });

  it('技能库只提供安装与删除：删除要确认，且真的调接口', async () => {
    render(<AgentSkillsPanel />);
    fireEvent.click(await screen.findByRole('tab', { name: '技能库' }));
    fireEvent.click(await screen.findByRole('button', { name: /删除技能 世界观顾问/ }));
    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith('worldbuilder'));
  });

  it('安装：选 agent 类时必须带归属智能体；提交后调安装接口', async () => {
    render(<AgentSkillsPanel />);
    fireEvent.click(await screen.findByRole('tab', { name: '技能库' }));
    fireEvent.click(await screen.findByRole('button', { name: /安装技能/ }));

    fireEvent.change(screen.getByPlaceholderText(/技能 id/), { target: { value: 'foreshadow-doctor' } });
    fireEvent.change(screen.getByPlaceholderText('展示名称'), { target: { value: '伏笔医生' } });
    fireEvent.change(screen.getByPlaceholderText(/技能正文/), { target: { value: '检查伏笔是否只埋不收' } });
    fireEvent.click(screen.getByRole('button', { name: /安装到技能库/ }));

    await waitFor(() => expect(mockInstall).toHaveBeenCalledWith(expect.objectContaining({
      id: 'foreshadow-doctor',
      name: '伏笔医生',
      category: 'agent',
      ownerAgent: 'writer',
    })));
  });

  it('★ 归属写了但清单没声明时显式报警（否则"装了却看不见"无从排查）', async () => {
    mockFetchLibrary.mockResolvedValue({
      skills: [], byCategory: { assistant: [], agent: [] },
      orphans: [{ agentId: 'ghost-agent', count: 2, skillIds: ['a', 'b'] }],
    });
    render(<AgentSkillsPanel />);
    fireEvent.click(await screen.findByRole('tab', { name: '技能库' }));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/ghost-agent/)).toBeInTheDocument();
    expect(within(alert).getByText(/永远看不到/)).toBeInTheDocument();
  });

  it('智能体一个技能都没有时，说明去哪儿装（不留空白格）', async () => {
    mockFetchTargetSkills.mockResolvedValue({ target: T({ id: 'plot-designer', name: '剧情设计师' }), skills: [] });
    render(<AgentSkillsPanel />);
    fireEvent.click(await screen.findByText('剧情设计师'));
    expect(await screen.findByText(/名下还没有技能/)).toBeInTheDocument();
  });
});
