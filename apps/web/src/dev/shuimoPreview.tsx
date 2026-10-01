import React from 'react';
import ReactDOM from 'react-dom/client';
import '../styles/globals.css';
import '../styles/themes.css';
import '../styles/shuimo.css';
import {
  SM_COLORS,
  SmBorder,
  SmButton,
  SmInput,
  SmPanel,
  SmRule,
  SmTextarea,
} from '../components/shuimo';

/**
 * 水墨UI（shuimo.design）移植层 · 视觉验证装置（开发期专用）
 *
 * ⚠️ 与 primitivesPreview.tsx 同样**不要**给它配独立 HTML 入口 —— vite.config 的
 *    `vite-plugin-html` 挂了 connect-history-api-fallback，Chrome 导航会被重写成
 *    /index.html 交给 SPA（详见 primitivesPreview.tsx 头部注释）。
 *
 * ✅ 正确打开方式：在已登录的任意页面 eval：
 *
 *    const old = document.getElementById('root');
 *    if (old) { old.id = '__app_root_stashed'; old.style.display = 'none'; }
 *    const d = document.createElement('div'); d.id = 'root';
 *    d.style.cssText = 'position:fixed;inset:0;overflow:auto;z-index:99';
 *    document.body.appendChild(d);
 *    const s = document.createElement('script'); s.type = 'module';
 *    s.textContent = "import('/src/dev/shuimoPreview.tsx')";
 *    document.head.appendChild(s);
 */

const THEMES = [
  { id: '', label: '墨韵（现状）' },
  { id: 'shuimo', label: '水墨UI（shuimo）' },
  { id: 'soot', label: '松烟' },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="sm-serif text-[15px] mb-3" style={{ color: 'hsl(var(--tone-2))' }}>
        {title}
      </h2>
      <SmRule className="mb-4" />
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4 mb-4">
      <div
        className="w-40 shrink-0 text-2xs pt-1.5"
        style={{ color: 'hsl(var(--tone-3))' }}
      >
        {label}
      </div>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

function App() {
  const [theme, setTheme] = React.useState<string>('shuimo');
  const [text, setText] = React.useState('');
  const [ta, setTa] = React.useState('');

  React.useEffect(() => {
    const el = document.documentElement;
    if (theme) el.dataset.theme = theme;
    else delete el.dataset.theme;
  }, [theme]);

  return (
    /* 宣纸底 / 远山只在 shuimo 主题下铺 —— 否则切到「墨韵」对照时背景不变，
       看不出差别（SmPaper 的宣纸是硬编码的，不跟主题走）。 */
    <div
      className={`min-h-screen px-10 py-8 ${
        theme === 'shuimo' ? 'sm-paper sm-mountains' : 'bg-background'
      }`}
    >
      {/* —— 页头：书法感标题 + 墨迹横线 —— */}
      <header className="mb-10">
        <div className="flex items-baseline justify-between">
          <h1 className="sm-serif text-[28px] tracking-wide" style={{ color: 'hsl(var(--tone))' }}>
            水墨UI · 移植层
          </h1>
          <div className="flex gap-1">
            {THEMES.map((t) => (
              <SmButton
                key={t.id}
                size="sm"
                ghost={theme !== t.id}
                onClick={() => setTheme(t.id)}
              >
                {t.label}
              </SmButton>
            ))}
          </div>
        </div>
        <SmRule className="mt-2" />
        <p className="mt-3 text-xs leading-relaxed" style={{ color: 'hsl(var(--tone-2))' }}>
          复刻自 shuimo.design 的水墨视觉语言（原库为 Vue 3，本项目 React 19 无法直接引用）。
          宣纸底 · 毛笔笔触边框 · 传统色 · 直角 · 衬线排版。
        </p>
      </header>

      <Section title="按钮 —— 五色（对应 shuimo 的 type）">
        <Row label="type">
          <SmButton>默认</SmButton>
          <SmButton type2="primary">主要</SmButton>
          <SmButton type2="confirm">确认</SmButton>
          <SmButton type2="error">错误</SmButton>
          <SmButton type2="warning">警告</SmButton>
        </Row>
        <Row label="size">
          <SmButton size="sm">小</SmButton>
          <SmButton size="md">中</SmButton>
          <SmButton size="lg">大</SmButton>
        </Row>
        <Row label="ghost / disabled">
          <SmButton ghost>描边</SmButton>
          <SmButton ghost type2="primary">
            描边·主要
          </SmButton>
          <SmButton disabled>禁用</SmButton>
        </Row>
      </Section>

      <Section title="输入框 —— 墨线底边">
        <Row label="input">
          <div className="w-80">
            <SmInput
              placeholder="请大侠输入……"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </div>
          <span className="text-xs" style={{ color: 'hsl(var(--tone-3))' }}>
            {text || '（空）'}
          </span>
        </Row>
        <Row label="textarea">
          <div className="w-96">
            <SmTextarea
              placeholder="请大侠落笔……"
              value={ta}
              onChange={(e) => setTa(e.target.value)}
            />
          </div>
        </Row>
        <Row label="disabled">
          <div className="w-80">
            <SmInput placeholder="不可编辑" disabled />
          </div>
        </Row>
      </Section>

      <Section title="笔触边框 / 面板">
        <div className="flex flex-wrap gap-6">
          <SmBorder surface className="p-0">
            <div className="px-5 py-4 sm-serif text-sm" style={{ color: 'hsl(var(--tone))' }}>
              笔触四边
              <div className="text-xs mt-1" style={{ color: 'hsl(var(--tone-2))' }}>
                四条手绘笔触图拼成的连续墨框
              </div>
            </div>
          </SmBorder>

          <SmPanel pad="md" className="w-72">
            <div className="sm-serif text-sm mb-1" style={{ color: 'hsl(var(--tone))' }}>
              纸面面板
            </div>
            <div className="text-xs leading-relaxed" style={{ color: 'hsl(var(--tone-2))' }}>
              宣纸纹理 + 勾线，无投影依赖。
            </div>
          </SmPanel>
        </div>
      </Section>

      <Section title={`传统色板 —— ${SM_COLORS.length} 色（自 shuimo Wuxing.css 原样搬入）`}>
        <div className="grid grid-cols-11 gap-2">
          {SM_COLORS.map((c) => (
            <div key={c.key} className="text-center">
              <div
                className="h-11 w-full border"
                style={{ background: c.hex, borderColor: 'hsl(var(--paper-line))' }}
                title={`${c.name} ${c.hex}`}
              />
              <div className="sm-serif text-2xs mt-1" style={{ color: 'hsl(var(--tone-2))' }}>
                {c.name}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="排版对照">
        <div className="flex gap-10">
          <div>
            <div className="text-2xs mb-2" style={{ color: 'hsl(var(--tone-3))' }}>
              衬线（shuimo 取向）
            </div>
            <p className="sm-serif text-lg leading-loose" style={{ color: 'hsl(var(--tone))' }}>
              空山新雨后，天气晚来秋。
            </p>
          </div>
          <div>
            <div className="text-2xs mb-2" style={{ color: 'hsl(var(--tone-3))' }}>
              无衬线（项目现状）
            </div>
            <p className="text-lg leading-loose" style={{ color: 'hsl(var(--tone))' }}>
              空山新雨后，天气晚来秋。
            </p>
          </div>
        </div>
      </Section>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
