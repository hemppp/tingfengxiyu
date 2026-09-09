import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from '../index';
import type { Project } from '@novel/shared';

describe('useProjectStore', () => {
  beforeEach(() => {
    useProjectStore.setState({
      currentProject: null,
      projects: [],
    });
  });

  describe('setProject', () => {
    it('应该设置当前项目', () => {
      const mockProject: Project = {
        id: 'proj-1',
        userId: 'test-user',
        name: '测试小说',
        description: '这是一个测试项目',
        currentWordCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      useProjectStore.getState().setProject(mockProject);

      const state = useProjectStore.getState();
      expect(state.currentProject).toEqual(mockProject);
      expect(state.currentProject?.id).toBe('proj-1');
    });

    it('应该替换现有的当前项目', () => {
      const project1: Project = {
        id: 'proj-1',
        userId: 'test-user',
        name: '项目一',
        currentWordCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const project2: Project = {
        id: 'proj-2',
        userId: 'test-user',
        name: '项目二',
        currentWordCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      useProjectStore.getState().setProject(project1);
      useProjectStore.getState().setProject(project2);

      expect(useProjectStore.getState().currentProject?.id).toBe('proj-2');
    });
  });

  describe('setProjects', () => {
    it('应该设置项目列表', () => {
      const mockProjects: Project[] = [
        {
          id: 'proj-1',
          userId: 'test-user',
          name: '项目一',
          currentWordCount: 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: 'proj-2',
          userId: 'test-user',
          name: '项目二',
          currentWordCount: 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ];

      useProjectStore.getState().setProjects(mockProjects);

      expect(useProjectStore.getState().projects).toHaveLength(2);
      expect(useProjectStore.getState().projects[0]!.name).toBe('项目一');
    });

    it('应该替换现有的项目列表', () => {
      const initialProjects: Project[] = [
        { id: 'proj-1', userId: 'test-user', name: '初始项目', currentWordCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
      ];

      const newProjects: Project[] = [
        { id: 'proj-2', userId: 'test-user', name: '新项目', currentWordCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
      ];

      useProjectStore.getState().setProjects(initialProjects);
      useProjectStore.getState().setProjects(newProjects);

      expect(useProjectStore.getState().projects).toHaveLength(1);
      expect(useProjectStore.getState().projects[0]!.id).toBe('proj-2');
    });
  });

  describe('updateProject', () => {
    it('应该更新当前项目的字段', () => {
      const initialProject: Project = {
        id: 'proj-1',
        userId: 'test-user',
        name: '原始名称',
        description: '原始描述',
        currentWordCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      useProjectStore.getState().setProject(initialProject);
      useProjectStore.getState().updateProject({
        name: '新名称',
        description: '新描述',
      });

      const updated = useProjectStore.getState().currentProject;
      expect(updated?.name).toBe('新名称');
      expect(updated?.description).toBe('新描述');
      expect(updated?.id).toBe('proj-1');
    });

    it('如果没有当前项目则不更新', () => {
      useProjectStore.getState().updateProject({ name: '新名称' });

      expect(useProjectStore.getState().currentProject).toBeNull();
    });

    it('应该保留未更改的字段', () => {
      const initialProject: Project = {
        id: 'proj-1',
        userId: 'test-user',
        name: '测试项目',
        description: '测试描述',
        coverImage: 'cover.jpg',
        penName: '作者名',
        genre: '奇幻',
        targetWordCount: 100000,
        currentWordCount: 5000,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      useProjectStore.getState().setProject(initialProject);
      useProjectStore.getState().updateProject({ name: '新名称' });

      const updated = useProjectStore.getState().currentProject;
      expect(updated?.name).toBe('新名称');
      expect(updated?.description).toBe('测试描述');
      expect(updated?.coverImage).toBe('cover.jpg');
      expect(updated?.targetWordCount).toBe(100000);
    });
  });

  describe('初始状态', () => {
    it('初始时 currentProject 应该为 null', () => {
      expect(useProjectStore.getState().currentProject).toBeNull();
    });

    it('初始时 projects 应该为空数组', () => {
      expect(useProjectStore.getState().projects).toEqual([]);
    });
  });
});
