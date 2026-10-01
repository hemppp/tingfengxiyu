import React, { useState } from 'react';
import { useProjectStore } from '@/stores';
import { Project } from '@novel/shared';

const TRANSITION = '0.3s cubic-bezier(0.16,1,0.3,1)';

const ProjectSelectPage: React.FC = () => {
  const projects = useProjectStore((s) => s.projects);
  const setProjects = useProjectStore((s) => s.setProjects);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDescription, setNewProjectDescription] = useState('');
  const [newProjectPenName, setNewProjectPenName] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const handleCreateProject = () => {
    if (!newProjectName.trim()) return;
    setIsCreating(true);
    const newProject: Project = {
      id: `proj_${Date.now()}`,
      userId: 'local-user',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      name: newProjectName.trim(),
      description: newProjectDescription.trim() || undefined,
      penName: newProjectPenName.trim() || undefined,
      currentWordCount: 0,
    };
    setProjects([...projects, newProject]);
    setNewProjectName('');
    setNewProjectDescription('');
    setNewProjectPenName('');
    setIsCreating(false);
  };

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-6xl mx-auto">
        <h1 style={{ fontFamily: "'Playfair Display','Georgia','Noto Serif SC',serif", fontSize: '2.5rem', fontWeight: 600, color: '#f5f5f3', marginBottom: '2rem', letterSpacing: '-0.02em' }}>
          Select Project
        </h1>
        <div className="rounded-xl p-6 mb-8" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 'var(--r-sm)', backdropFilter: 'blur(12px)', transition: TRANSITION }}
          onMouseEnter={(e) => e.currentTarget.style.borderColor = 'rgba(0,0,0,0.25)'}
          onMouseLeave={(e) => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'}>
          <h2 style={{ fontFamily: "'Playfair Display','Georgia','Noto Serif SC',serif", fontSize: '1.25rem', fontWeight: 600, color: '#000000', marginBottom: '1.5rem' }}>
            Create New Project
          </h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: '#f5f5f3' }}>项目名称 *</label>
              <input type="text" value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)}
                className="w-full px-3 py-2 rounded-md outline-none"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#f5f5f3', borderRadius: 'var(--r-2xs)', transition: TRANSITION }}
                onFocus={(e) => e.target.style.borderColor = 'rgba(0,0,0,0.5)'}
                onBlur={(e) => e.target.style.borderColor = 'rgba(255,255,255,0.1)'}
                placeholder="输入项目名称" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: '#f5f5f3' }}>简介</label>
              <textarea value={newProjectDescription} onChange={(e) => setNewProjectDescription(e.target.value)}
                className="w-full px-3 py-2 rounded-md outline-none resize-none" rows={3}
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#f5f5f3', borderRadius: 'var(--r-2xs)', transition: TRANSITION }}
                onFocus={(e) => e.target.style.borderColor = 'rgba(0,0,0,0.5)'}
                onBlur={(e) => e.target.style.borderColor = 'rgba(255,255,255,0.1)'}
                placeholder="输入简介（可选）" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: '#f5f5f3' }}>笔名</label>
              <input type="text" value={newProjectPenName} onChange={(e) => setNewProjectPenName(e.target.value)}
                className="w-full px-3 py-2 rounded-md outline-none"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#f5f5f3', borderRadius: 'var(--r-2xs)', transition: TRANSITION }}
                onFocus={(e) => e.target.style.borderColor = 'rgba(0,0,0,0.5)'}
                onBlur={(e) => e.target.style.borderColor = 'rgba(255,255,255,0.1)'}
                placeholder="输入笔名（可选）" />
            </div>
            <button onClick={handleCreateProject} disabled={!newProjectName.trim() || isCreating}
              className="px-6 py-2 rounded-md font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed enabled:hover:brightness-125"
              style={{ background: newProjectName.trim() ? '#000000' : 'rgba(0,0,0,0.25)', color: newProjectName.trim() ? '#ffffff' : 'rgba(245,245,243,0.35)', borderRadius: 'var(--r-2xs)', transition: TRANSITION }}>
              {isCreating ? 'Creating...' : 'Create New Project'}
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.length === 0 ? (
            <div className="col-span-3 text-center py-16 rounded-xl" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 'var(--r-sm)' }}>
              <p className="text-lg" style={{ color: 'rgba(245,245,243,0.25)' }}>暂无项目，创建你的第一个项目吧！</p>
            </div>
          ) : (
            projects.map((project) => (
              <div key={project.id} className="overflow-hidden cursor-pointer transition-all" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 'var(--r-sm)', transition: TRANSITION }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(0,0,0,0.3)'; e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 30px rgba(0,0,0,0.2)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none'; }}>
                <div className="p-5">
                  <h3 className="font-semibold mb-2" style={{ fontFamily: "'Playfair Display','Georgia','Noto Serif SC',serif", fontSize: '1.1rem', color: '#f5f5f3' }}>{project.name}</h3>
                  {project.description && <p className="text-sm mb-3" style={{ color: 'rgba(245,245,243,0.45)' }}>{project.description}</p>}
                  <div className="flex items-center gap-4 text-xs" style={{ color: 'rgba(245,245,243,0.25)' }}>
                    <span>{project.currentWordCount || 0} words</span>
                    <span>Created {new Date(project.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default ProjectSelectPage;
