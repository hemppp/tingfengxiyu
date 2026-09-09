import { useState, useEffect, useCallback } from 'react';
import { Loader2, CheckCircle, XCircle, HardDrive } from 'lucide-react';
import { setAIConfig } from '@/services/ai/aiClient';

interface OllamaModels {
  models: Array<{ name: string; size: number; modified_at: string }>;
}

export function LocalModelPanel() {
  const [ollamaUrl, setOllamaUrl] = useState(() => {
    try { return localStorage.getItem('ollama_base_url') || 'http://localhost:11434'; } catch { return 'http://localhost:11434'; }
  });
  const [models, setModels] = useState<OllamaModels['models']>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isOllamaRunning, setIsOllamaRunning] = useState<boolean | null>(null);

  const checkOllama = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const data: OllamaModels = await res.json();
        setModels(data.models || []);
        setIsOllamaRunning(true);
      } else {
        setIsOllamaRunning(false);
        setError(`Ollama 返回 ${res.status}`);
      }
    } catch (e) {
      setIsOllamaRunning(false);
      setError(e instanceof Error ? e.message : '无法连接到 Ollama');
    }
    setLoading(false);
  }, [ollamaUrl]);

  useEffect(() => { checkOllama(); }, [checkOllama]);

  const handleSave = () => {
    try { localStorage.setItem('ollama_base_url', ollamaUrl); } catch { /* 存储不可用时静默忽略 */ }
    setAIConfig({
      baseUrl: ollamaUrl,
      apiKey: 'ollama',
      model: models[0]?.name || 'llama3',
      provider: 'ollama',
    });
    checkOllama();
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
    return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2 mb-4">
        <HardDrive size={20} />
        <h2 className="text-lg font-semibold">本地模型配置</h2>
      </div>

      <div className="flex items-center gap-2 p-3 border rounded-2xl">
        {loading ? (
          <Loader2 size={16} className="animate-spin text-muted-foreground" />
        ) : isOllamaRunning === true ? (
          <CheckCircle size={16} className="text-green-500" />
        ) : (
          <XCircle size={16} className="text-destructive" />
        )}
        <span className="text-sm">
          {loading ? '检测中...' :
            isOllamaRunning ? `✓ Ollama 运行中，发现 ${models.length} 个模型` :
            '✗ Ollama 未运行或无法连接'}
        </span>
        <button onClick={checkOllama} className="ml-auto text-xs text-primary hover:underline">
          重新检测
        </button>
      </div>

      <div>
        <label className="text-sm font-medium block mb-1">Ollama 地址</label>
        <input
          value={ollamaUrl}
          onChange={(e) => setOllamaUrl(e.target.value)}
          className="w-full px-3 py-2 border rounded-[14px] bg-background text-sm"
          placeholder="http://localhost:11434"
        />
        <p className="text-xs text-muted-foreground mt-1">
          默认: http://localhost:11434（Ollama 默认端口）
        </p>
      </div>

      {models.length > 0 && (
        <div>
          <label className="text-sm font-medium block mb-1">已安装模型</label>
          <div className="border rounded-2xl divide-y">
            {models.map((model) => (
              <div key={model.name} className="px-3 py-2 flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">{model.name}</div>
                  <div className="text-xs text-muted-foreground">{formatSize(model.size)}</div>
                </div>
                <button
                  onClick={() => {
                    try { localStorage.setItem('ollama_base_url', ollamaUrl); } catch { /* 存储不可用时静默忽略 */ }
                    setAIConfig({
                      baseUrl: ollamaUrl,
                      apiKey: 'ollama',
                      model: model.name,
                      provider: 'ollama',
                    });
                    alert(`已选择模型: ${model.name}`);
                  }}
                  className="text-xs px-2 py-1 border rounded-xl hover:bg-accent"
                >
                  使用
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={handleSave}
        className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm"
      >
        保存并切换到本地模型
      </button>

      <div className="p-3 bg-muted/50 rounded-lg text-xs text-muted-foreground">
        <p className="font-medium text-foreground mb-1">安装 Ollama + 模型指南</p>
        <p>1. 下载 Ollama: <span className="font-mono">https://ollama.com/download</span></p>
        <p>2. 安装模型: <span className="font-mono">ollama pull llama3</span> 或 <span className="font-mono">ollama pull phi3</span></p>
        <p>3. 启动服务: <span className="font-mono">ollama serve</span>（通常自动启动）</p>
      </div>

      {error && (
        <div className="p-3 bg-destructive/10 text-destructive rounded-2xl text-sm">{error}</div>
      )}
    </div>
  );
}
