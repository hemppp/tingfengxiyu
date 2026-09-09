import { useState, useEffect, useRef } from 'react';
import { useAIStore } from '@/stores/aiStore';
import { getAIConfig, testAIConnection, listModels, maskApiKey,
  normalizeBaseUrl, type ModelListItem } from '@/services/ai/aiClient';
import {
  Loader2,
  Check,
  X,
  RotateCcw,
  HardDrive,
  Save,
  Wifi,
  ListTree,
  Eye,
  EyeOff,
  Server,
  Globe,
  ChevronDown,
  RefreshCw,
} from 'lucide-react';
import { LocalModelPanel } from './LocalModelPanel';

type ResultKind = 'success' | 'error' | 'info';
interface ResultState {
  kind: ResultKind;
  msg: string;
}

export function AIConfigPanel() {
  const { config, updateConfig, resetConfig, loadConfig } = useAIStore();
  const [showLocalModel, setShowLocalModel] = useState(false);

  // —— 三个核心状态 ——
  // 草稿态：用户当前在输入框里编辑的内容（未点保存）。
  // 服务端不会回传已保存的完整 Key，因此空草稿表示“保留已有 Key”，而不是清空。
  const [draftBaseUrl, setDraftBaseUrl] = useState(config.baseUrl);
  const [draftApiKey, setDraftApiKey] = useState(config.apiKey);
  const [draftModel, setDraftModel] = useState(config.model);

  // API Key 可见性（小眼睛）
  const [showKey, setShowKey] = useState(false);

  // 探测状态
  const [pingState, setPingState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [pingInfo, setPingInfo] = useState<{ latencyMs?: number; status?: number; isBackend?: boolean } | null>(null);

  const [modelState, setModelState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [models, setModels] = useState<ModelListItem[]>([]);
  const [modelSelectOpen, setModelSelectOpen] = useState(false);
  const [modelFilter, setModelFilter] = useState('');

  // 通用结果条
  const [result, setResult] = useState<ResultState | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const modelsAbortRef = useRef<AbortController | null>(null);

  // 当 store 中的持久化配置变化时（例如重置 / 外部写入），同步到草稿。
  // 已保存的 Key 不回传，故 apiKey 为空时不要把用户正在输入的新 Key 擦掉。
  useEffect(() => {
    setDraftBaseUrl(config.baseUrl);
    setDraftApiKey(config.apiKey || '');
    setDraftModel(config.model);
  }, [config.baseUrl, config.apiKey, config.model]);

  // 挂载时从后端加载已保存的配置
  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  // 卸载时取消模型拉取
  useEffect(() => {
    return () => {
      modelsAbortRef.current?.abort();
    };
  }, []);

  // 是否已"配置"（这里只校验 URL；Key 允许后端或显式为空）
  const hasUrl = !!draftBaseUrl.trim();
  const effectiveApiKey = draftApiKey.trim();
  // 内置公益中转站：服务端返回 label 时生效；用户开始填写自有地址后按第三方处理
  const backendHint = Boolean(config.label) && !hasUrl;

  // 当前模型下拉过滤
  const filteredModels = models.filter((m) =>
    modelFilter ? (m.id ?? '').toLowerCase().includes(modelFilter.toLowerCase()) : true,
  );

  // —— 1) 测试链路是否通畅（轻量 GET 探活）——
  // 与 handleListModels 同理：先保存草稿到后端，再调用 /config/test，
  // 否则后端会用数据库里的旧配置测试，导致用户刚输入的中转站地址不生效。
  const handlePing = async () => {
    if (!hasUrl) {
      setResult({ kind: 'error', msg: '请先填写 API 地址' });
      return;
    }
    setPingState('loading');
    setPingInfo(null);
    setResult(null);
    try {
      // 先保存草稿，确保后端用最新配置测试
      const normalized = normalizeBaseUrl(draftBaseUrl);
      await updateConfig({
        baseUrl: normalized,
        apiKey: effectiveApiKey,
        model: draftModel.trim(),
      });
      setSavedConfig({
        baseUrl: normalized,
        apiKey: effectiveApiKey,
        model: draftModel.trim(),
        apiKeyConfigured: Boolean(effectiveApiKey) || config.apiKeyConfigured === true,
        apiKeyHint: effectiveApiKey ? maskApiKey(effectiveApiKey) : (config.apiKeyHint ?? ''),
      });

      const res = await testAIConnection();
      if (res.connected) {
        setPingState('success');
        setPingInfo({ latencyMs: res.latencyMs });
        setResult({
          kind: 'success',
          msg: `✅ 链路通畅${res.latencyMs !== undefined ? `（${res.latencyMs}ms）` : ''}`,
        });
      } else {
        setPingState('error');
        setPingInfo(null);
        setResult({
          kind: 'error',
          msg: `❌ 不可达：${res.error || '未知错误'}`,
        });
      }
    } catch (e) {
      setPingState('error');
      setResult({ kind: 'error', msg: `❌ 探测失败：${e instanceof Error ? e.message : '未知错误'}` });
    }
  };

  // —— 2) 获取模型列表（替代旧的"测试连接"）——
  // 注意：必须先保存草稿到后端，否则 /api/ai/models 会从数据库读旧配置，
  // 导致用户刚输入的中转站 baseUrl/apiKey 不生效（仍用环境变量默认值请求）。
  const handleListModels = async () => {
    if (!hasUrl) {
      setResult({ kind: 'error', msg: '请先填写 API 地址' });
      return;
    }
    if (!effectiveApiKey && !backendHint) {
      setResult({ kind: 'error', msg: '请先填写 API Key' });
      return;
    }
    // 取消上一次拉取
    modelsAbortRef.current?.abort();
    const controller = new AbortController();
    modelsAbortRef.current = controller;

    setModelState('loading');
    setModels([]);
    setResult(null);
    setModelSelectOpen(true);
    setModelFilter('');

    try {
      // 1) 先把当前草稿保存到后端，确保 /models 读到的是最新配置
      const normalized = normalizeBaseUrl(draftBaseUrl);
      await updateConfig({
        baseUrl: normalized,
        apiKey: effectiveApiKey,
        model: draftModel.trim(),
      });
      // 同步本地草稿（updateConfig 内部会刷新 store）
      setSavedConfig({
        baseUrl: normalized,
        apiKey: effectiveApiKey,
        model: draftModel.trim(),
        apiKeyConfigured: Boolean(effectiveApiKey) || config.apiKeyConfigured === true,
        apiKeyHint: effectiveApiKey ? maskApiKey(effectiveApiKey) : (config.apiKeyHint ?? ''),
      });

      // 2) 再调用 /models（此时后端数据库已是最新配置）
      const res = await listModels();
      if (!res.ok) {
        setModelState('error');
        setResult({ kind: 'error', msg: `❌ 获取失败：${res.error || `HTTP ${res.status ?? '?'}`}` });
        return;
      }
      setModels(res.models);
      setModelState(res.models.length > 0 ? 'success' : 'error');
      setResult({
        kind: res.models.length > 0 ? 'success' : 'info',
        msg:
          res.models.length > 0
            ? `✅ 共 ${res.models.length} 个模型可选`
            : '该服务未返回任何模型（可能未启用 /v1/models）',
      });
    } catch (e) {
      if (controller.signal.aborted) return;
      setModelState('error');
      setResult({ kind: 'error', msg: `❌ 获取失败：${e instanceof Error ? e.message : '未知错误'}` });
    }
  };

  // —— 3) 保存 API 配置（显式保存）——
  const handleSave = async () => {
    if (!hasUrl) {
      setResult({ kind: 'error', msg: '请先填写 API 地址' });
      return;
    }
    setIsSaving(true);
    try {
      const normalized = normalizeBaseUrl(draftBaseUrl);
      await updateConfig({
        baseUrl: normalized,
        apiKey: effectiveApiKey,
        model: draftModel.trim(),
      });
      setResult({
        kind: 'success',
        msg: backendHint
          ? '✅ 已保存：使用内置后端作为 AI 服务'
          : '✅ 已保存：API 已加密并持久化',
      });
    } catch (e) {
      setResult({ kind: 'error', msg: `❌ 保存失败：${e instanceof Error ? e.message : '未知错误'}` });
    } finally {
      setIsSaving(false);
    }
  };

  // 选中某个模型
  const pickModel = (id: string) => {
    setDraftModel(id);
    setModelSelectOpen(false);
  };

  // 当前已持久化的展示摘要（用于底部"已保存"小卡片；完整 Key 永不回传）
  const [savedConfig, setSavedConfig] = useState({
    baseUrl: '',
    apiKey: '',
    model: '',
    apiKeyConfigured: false,
    apiKeyHint: '',
  });
  const showPersisted = savedConfig.baseUrl || savedConfig.apiKeyConfigured || savedConfig.model;
  const savedIsBackend = false;

  useEffect(() => {
    getAIConfig().then((cfg) => setSavedConfig({
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model: cfg.model,
      apiKeyConfigured: Boolean(cfg.apiKeyConfigured),
      apiKeyHint: cfg.apiKeyHint ?? '',
    }));
  }, []);

  return (
    <div className="space-y-4">
      <p className="text-sm" style={{ color: 'rgba(26,46,43,0.75)' }}>
        配置 AI 服务后，AI 预判、章节扫描、智能检测等功能将自动使用 AI。
        <br />
        支持 OpenAI 兼容协议（OpenAI · DeepSeek · 通义千问 · Ollama · 各种中转站 API）。
      </p>

      {/* —— API 地址 —— */}
      <div>
        <label className="text-sm font-medium flex items-center gap-2">
          API 地址
          {backendHint ? (
            <span
              className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-xl font-medium"
              style={{ background: 'rgba(35,131,116,0.12)', color: '#1e6fa8' }}
            >
              <Server size={10} /> {config.label ?? '内置后端'}
            </span>
          ) : hasUrl ? (
            <span
              className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-xl font-medium"
              style={{ background: 'rgba(212,184,125,0.15)', color: '#8a6d3b' }}
            >
              <Globe size={10} /> 第三方 / 中转站
            </span>
          ) : null}
        </label>
        <div className="flex gap-2 mt-1">
          <input
            type="text"
            value={draftBaseUrl}
            onChange={(e) => setDraftBaseUrl(e.target.value)}
            className="flex-1 px-3 py-2 border rounded-[14px] text-sm font-mono outline-none transition-all focus:border-mountain-cyan/60"
            style={{
              background: 'rgba(255,255,255,0.7)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              borderColor: 'rgba(35,131,199,0.3)',
              color: '#1a2030',
              boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.04), 0 1px 0 rgba(255,255,255,0.6)',
            }}
            placeholder="https://api.openai.com/v1  或  https://中转站/v1"
          />
          <button
            onClick={handlePing}
            disabled={!hasUrl || pingState === 'loading'}
            className="px-4 py-2 rounded-md text-sm font-medium flex items-center gap-1.5 disabled:opacity-40 transition-all"
            style={{
              background: 'rgba(255,255,255,0.6)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              border: '1px solid rgba(35,131,199,0.3)',
              color: '#1e6fa8',
              boxShadow: '0 2px 8px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.8)',
            }}
            onMouseEnter={(e) => {
              if (!e.currentTarget.disabled) {
                e.currentTarget.style.background = 'rgba(255,255,255,0.8)';
                e.currentTarget.style.borderColor = 'rgba(35,131,199,0.5)';
              }
            }}
            onMouseLeave={(e) => {
              if (!e.currentTarget.disabled) {
                e.currentTarget.style.background = 'rgba(255,255,255,0.6)';
                e.currentTarget.style.borderColor = 'rgba(35,131,199,0.3)';
              }
            }}
            title="测试当前 API 地址是否可连通"
            aria-label="测试 API 链路是否通畅"
          >
            {pingState === 'loading' ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Wifi size={14} />
            )}
            测试连通
          </button>
        </div>
        {hasUrl && (
          <p className="text-[11px] text-muted-foreground mt-1">
            规范化：<span className="font-mono">{normalizeBaseUrl(draftBaseUrl)}</span>
            {pingInfo?.latencyMs !== undefined && (
              <> · 延迟 <span className="font-mono">{pingInfo.latencyMs}ms</span></>
            )}
          </p>
        )}
      </div>

      {/* —— API 密钥（服务端安全保存，已保存的完整 Key 不回传） —— */}
      <div>
        <label className="text-sm font-medium">API 密钥</label>
        <div className="flex gap-2 mt-1">
          <div className="flex-1 relative">
            <input
              type={showKey ? 'text' : 'password'}
              value={draftApiKey}
              onChange={(e) => setDraftApiKey(e.target.value)}
              className="w-full px-3 py-2 pr-10 border rounded-[14px] text-sm font-mono outline-none transition-all focus:border-mountain-cyan/60"
              style={{
                background: 'rgba(255,255,255,0.7)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                borderColor: 'rgba(35,131,199,0.3)',
                color: '#1a2030',
                boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.04), 0 1px 0 rgba(255,255,255,0.6)',
              }}
              placeholder={backendHint ? '已内置公益中转站，无需 Key（可留空）' : 'sk-...'}
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              title={showKey ? '隐藏 Key' : '显示 Key（看清密文）'}
              aria-label={showKey ? '隐藏 API Key' : '显示 API Key'}
            >
              {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground mt-1">
          {draftApiKey
            ? showKey
              ? <>当前明文：<span className="font-mono break-all">{draftApiKey}</span></>
              : <>预览（脱敏）：<span className="font-mono">{maskApiKey(draftApiKey)}</span> · 保存后由服务端保管</>
            : config.apiKeyConfigured
              ? '已配置 Key（完整密钥不会回传浏览器）；输入新 Key 可替换。'
              : '填写后由服务端安全保存，已保存的完整 Key 不会回传到浏览器。'}
        </p>
      </div>

      {/* —— 模型名称 —— */}
      <div>
        <label className="text-sm font-medium">模型名称</label>
        <div className="flex gap-2 mt-1">
          <div className="flex-1 relative">
            <input
              type="text"
              value={draftModel}
              onChange={(e) => setDraftModel(e.target.value)}
              className="w-full px-3 py-2 pr-9 border rounded-[14px] text-sm font-mono outline-none transition-all focus:border-mountain-cyan/60"
              style={{
                background: 'rgba(255,255,255,0.7)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                borderColor: 'rgba(35,131,199,0.3)',
                color: '#1a2030',
                boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.04), 0 1px 0 rgba(255,255,255,0.6)',
              }}
              placeholder="gpt-4-turbo / deepseek-chat / qwen2.5"
            />
            {models.length > 0 && (
              <button
                type="button"
                onClick={() => setModelSelectOpen((v) => !v)}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                title="从已获取的模型列表中选择"
                aria-label="从模型列表选择"
              >
                <ChevronDown size={14} className={modelSelectOpen ? 'rotate-180 transition-transform' : 'transition-transform'} />
              </button>
            )}
          </div>
          <button
            onClick={handleListModels}
            disabled={!hasUrl || modelState === 'loading'}
            className="px-4 py-2 rounded-md text-sm font-medium flex items-center gap-1.5 disabled:opacity-40 transition-all"
            style={{
              background: 'rgba(255,255,255,0.6)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              border: '1px solid rgba(35,131,199,0.3)',
              color: '#1e6fa8',
              boxShadow: '0 2px 8px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.8)',
            }}
            onMouseEnter={(e) => {
              if (!e.currentTarget.disabled) {
                e.currentTarget.style.background = 'rgba(255,255,255,0.8)';
                e.currentTarget.style.borderColor = 'rgba(35,131,199,0.5)';
              }
            }}
            onMouseLeave={(e) => {
              if (!e.currentTarget.disabled) {
                e.currentTarget.style.background = 'rgba(255,255,255,0.6)';
                e.currentTarget.style.borderColor = 'rgba(35,131,199,0.3)';
              }
            }}
            title="从 /v1/models 拉取该服务提供的全部模型"
            aria-label="获取模型列表"
          >
            {modelState === 'loading' ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <ListTree size={14} />
            )}
            获取模型
          </button>
        </div>
        {modelSelectOpen && models.length > 0 && (
          <div className="mt-1 border rounded bg-card shadow-sm max-h-56 overflow-y-auto">
            <div className="p-2 sticky top-0 bg-card border-b">
              <input
                value={modelFilter}
                onChange={(e) => setModelFilter(e.target.value)}
                placeholder="筛选模型…"
                className="w-full px-2 py-1 text-xs border rounded-[14px] bg-transparent font-mono"
              />
            </div>
            {filteredModels.length === 0 ? (
              <p className="text-xs text-muted-foreground p-3">无匹配模型</p>
            ) : (
              <ul>
                {filteredModels.slice(0, 200).map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => pickModel(m.id ?? '')}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted font-mono flex items-center justify-between"
                    >
                      <span>{m.id}</span>
                      {m.name && m.name !== m.id && (
                        <span className="text-muted-foreground ml-2">{m.name}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <p className="text-xs text-muted-foreground mt-1">
          点击「获取模型」从 <code className="font-mono">GET /v1/models</code> 拉取可选模型；或直接手动输入。
        </p>
      </div>

      {/* —— 操作按钮组 —— */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={handleSave}
          disabled={isSaving || !hasUrl}
          className="px-4 py-2 rounded-md text-sm font-medium disabled:opacity-40 flex items-center gap-1.5 transition-all"
          style={{
            background: 'linear-gradient(135deg, #1e6fa8 0%, #1c6e62 100%)',
            color: '#ffffff',
            boxShadow: '0 4px 14px rgba(35,131,116,0.35), inset 0 1px 0 rgba(255,255,255,0.25)',
            border: '1px solid rgba(35,131,116,0.6)',
          }}
          onMouseEnter={(e) => {
            if (!e.currentTarget.disabled) {
              e.currentTarget.style.transform = 'translateY(-1px)';
              e.currentTarget.style.boxShadow = '0 6px 20px rgba(35,131,116,0.45), inset 0 1px 0 rgba(255,255,255,0.3)';
            }
          }}
          onMouseLeave={(e) => {
            if (!e.currentTarget.disabled) {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 4px 14px rgba(35,131,116,0.35), inset 0 1px 0 rgba(255,255,255,0.25)';
            }
          }}
        >
          {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {isSaving ? '保存中…' : '保存 API'}
        </button>
        <button
          onClick={handleListModels}
          disabled={!hasUrl || modelState === 'loading'}
          className="px-4 py-2 rounded-md text-sm font-medium flex items-center gap-1.5 disabled:opacity-40 transition-all"
          style={{
            background: 'rgba(255,255,255,0.6)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            border: '1px solid rgba(35,131,199,0.3)',
            color: '#1e6fa8',
            boxShadow: '0 2px 8px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.8)',
          }}
          onMouseEnter={(e) => {
            if (!e.currentTarget.disabled) {
              e.currentTarget.style.background = 'rgba(255,255,255,0.8)';
              e.currentTarget.style.borderColor = 'rgba(35,131,199,0.5)';
            }
          }}
          onMouseLeave={(e) => {
            if (!e.currentTarget.disabled) {
              e.currentTarget.style.background = 'rgba(255,255,255,0.6)';
              e.currentTarget.style.borderColor = 'rgba(35,131,199,0.3)';
            }
          }}
          aria-label="获取模型列表"
        >
          {modelState === 'loading' ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <RefreshCw size={14} />
          )}
          获取模型
        </button>
        <button
          onClick={resetConfig}
          className="px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-1.5 transition-all"
          style={{
            background: 'rgba(255,255,255,0.6)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            border: '1px solid rgba(0,0,0,0.15)',
            color: 'rgba(0,0,0,0.65)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.05), inset 0 1px 0 rgba(255,255,255,0.8)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.8)';
            e.currentTarget.style.borderColor = 'rgba(0,0,0,0.3)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.6)';
            e.currentTarget.style.borderColor = 'rgba(0,0,0,0.15)';
          }}
        >
          <RotateCcw size={14} /> 重置
        </button>
        <button
          onClick={() => setShowLocalModel(v => !v)}
          className="px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-1.5 transition-all"
          style={{
            background: showLocalModel ? 'rgba(35,131,116,0.15)' : 'rgba(255,255,255,0.6)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            border: showLocalModel ? '1px solid rgba(35,131,116,0.5)' : '1px solid rgba(35,131,199,0.3)',
            color: '#1e6fa8',
            boxShadow: '0 2px 8px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.8)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = showLocalModel ? 'rgba(35,131,116,0.22)' : 'rgba(255,255,255,0.8)';
            e.currentTarget.style.borderColor = 'rgba(35,131,199,0.5)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = showLocalModel ? 'rgba(35,131,116,0.15)' : 'rgba(255,255,255,0.6)';
            e.currentTarget.style.borderColor = showLocalModel ? 'rgba(35,131,116,0.5)' : 'rgba(35,131,199,0.3)';
          }}
          aria-expanded={showLocalModel}
        >
          <HardDrive size={14} /> 本地模型
        </button>
      </div>

      {/* —— 本地模型 inline 弹层（原 /local-model 路由已并入此处） —— */}
      {showLocalModel && (
        <div className="rounded-2xl border bg-card/50 p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium">本地模型（Ollama）</h3>
            <button
              onClick={() => setShowLocalModel(false)}
              className="text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-xl transition-colors px-2 py-1"
              aria-label="关闭本地模型"
            >
              收起
            </button>
          </div>
          <LocalModelPanel />
        </div>
      )}

      {/* —— 通用结果条 —— */}
      {result && (
        <div
          className={`text-sm p-3 rounded-lg flex items-start gap-2 ${
            result.kind === 'success'
              ? 'bg-green-500/10 text-green-600 border border-green-500/20'
              : result.kind === 'error'
                ? 'bg-red-500/10 text-red-500 border border-red-500/20'
                : 'bg-blue-500/10 text-blue-600 border border-blue-500/20'
          }`}
        >
          {result.kind === 'success' ? (
            <Check size={16} className="mt-0.5 shrink-0" />
          ) : result.kind === 'error' ? (
            <X size={16} className="mt-0.5 shrink-0" />
          ) : (
            <ListTree size={16} className="mt-0.5 shrink-0" />
          )}
          <span>{result.msg}</span>
        </div>
      )}

      {/* —— 持久化状态（已保存摘要） —— */}
      {showPersisted && (
        <div className="text-xs text-muted-foreground border-t pt-3 mt-4 space-y-0.5">
          <p className="font-medium text-foreground/80">当前已保存配置：</p>
          <p className="font-mono">
            URL: {savedConfig.baseUrl || '未设置'}
            {savedIsBackend && (
              <span
                className="ml-2 inline-flex items-center gap-0.5 text-[10px] px-1 rounded-xl"
                style={{ background: 'rgba(35,131,116,0.12)', color: '#1e6fa8' }}
              >
                <Server size={9} /> 内置后端
              </span>
            )}
          </p>
          <p className="font-mono">
            Key: {savedConfig.apiKeyConfigured ? (savedConfig.apiKeyHint || '已配置') : '未设置'}
            <span className="ml-2 text-green-600/70">（服务端安全保存）</span>
          </p>
          <p className="font-mono">模型: {savedConfig.model || '未设置'}</p>
          <p className="text-green-600/70 mt-1">✓ 配置已安全持久化到服务端，完整 Key 不回传浏览器</p>
        </div>
      )}
    </div>
  );
}
