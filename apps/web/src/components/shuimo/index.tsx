import React from 'react';

/**
 * 水墨UI（shuimo.design）React 组件层
 *
 * ## 背景：为什么不是直接 import shuimo-ui
 *
 * shuimo-ui 是 **Vue 3** 组件库，本项目是 React 19 —— 装进来也无法渲染。
 * 本层用 React 重新实现它的视觉语言（样式见 `styles/shuimo.css`），
 * API 尽量贴近原库（`type` 而非 `variant`，与 shuimo 的 `<m-button type="primary">` 对齐）。
 *
 * ## 使用前提
 *
 * 需在根元素挂 `data-theme="shuimo"` 才会拿到宣纸底 + 传统色 + 直角 + 毛笔光标。
 * 组件本身不依赖该属性即可工作（`.sm-*` 类自带样式），只是会缺少主题变量。
 *
 * ## 已知未覆盖
 *
 * shuimo 还有 select / datePicker / switch / slider / radio / checkbox / progress /
 * tag / list / tree / pagination / dialog / message / breadcrumb / collapse 等组件，
 * 本层目前只落了**最高频的四件套**（按钮 / 输入 / 面板 / 分割）。其余按需补。
 */

type SmButtonType = 'default' | 'primary' | 'confirm' | 'error' | 'warning';
type SmButtonSize = 'sm' | 'md' | 'lg';

export interface SmButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** 对应 shuimo 的 `type` 属性 */
  type2?: SmButtonType;
  size?: SmButtonSize;
  /** 描边款（无实色填充） */
  ghost?: boolean;
}

/**
 * 水墨按钮。
 *
 * ⚠️ 属性名用 `type2` 而不是 `type`：原生 `<button type="submit">` 已被占用，
 * 改名比覆盖原生语义安全（shuimo 在 Vue 里没这个冲突，React 有）。
 */
export const SmButton = React.forwardRef<HTMLButtonElement, SmButtonProps>(function SmButton(
  { type2 = 'default', size = 'md', ghost, className = '', children, ...rest },
  ref,
) {
  const classes = [
    'sm-btn',
    type2 !== 'default' && !ghost ? `sm-btn--${type2}` : '',
    ghost ? 'sm-btn--ghost' : '',
    size !== 'md' ? `sm-btn--${size}` : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button ref={ref} className={classes} {...rest}>
      {children}
    </button>
  );
});

export interface SmInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {}

/** 水墨输入框（墨线底边） */
export const SmInput = React.forwardRef<HTMLInputElement, SmInputProps>(function SmInput(
  { className = '', ...rest },
  ref,
) {
  return <input ref={ref} className={`sm-input ${className}`} {...rest} />;
});

export interface SmTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

/** 水墨多行输入 */
export const SmTextarea = React.forwardRef<HTMLTextAreaElement, SmTextareaProps>(
  function SmTextarea({ className = '', ...rest }, ref) {
    return <textarea ref={ref} className={`sm-textarea ${className}`} {...rest} />;
  },
);

export interface SmPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 面板内边距档位 */
  pad?: 'none' | 'sm' | 'md' | 'lg';
}

const PAD: Record<NonNullable<SmPanelProps['pad']>, string> = {
  none: '',
  sm: 'p-3',
  md: 'p-5',
  lg: 'p-8',
};

/** 纸面面板 */
export function SmPanel({ pad = 'md', className = '', children, ...rest }: SmPanelProps) {
  return (
    <div className={`sm-panel ${PAD[pad]} ${className}`} {...rest}>
      {children}
    </div>
  );
}

export interface SmBorderProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 内部背景（不传则透明） */
  surface?: boolean;
}

/**
 * 笔触四边框 —— 复刻 shuimo `.m-border` 的 grid 九宫格。
 *
 * 用四条手绘笔触图拼出连续墨框，比 `border: 1px solid` 有手写感。
 */
export function SmBorder({ surface, className = '', children, ...rest }: SmBorderProps) {
  return (
    <div className={`sm-border ${className}`} {...rest}>
      <span className="sm-border__line sm-border__top" aria-hidden />
      <span className="sm-border__line sm-border__right" aria-hidden />
      <span className="sm-border__line sm-border__bottom" aria-hidden />
      <span className="sm-border__line sm-border__left" aria-hidden />
      <div
        className="sm-border__main"
        style={surface ? { background: 'hsl(var(--card))' } : undefined}
      >
        {children}
      </div>
    </div>
  );
}

export interface SmRuleProps extends React.HTMLAttributes<HTMLHRElement> {
  vertical?: boolean;
}

/** 墨迹分割线 */
export function SmRule({ vertical, className = '', ...rest }: SmRuleProps) {
  return (
    <hr
      className={`sm-rule ${vertical ? 'sm-rule--v' : ''} ${className}`}
      aria-hidden
      {...rest}
    />
  );
}

export interface SmPaperProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 暖色宣纸 */
  warm?: boolean;
}

/** 宣纸底容器 */
export function SmPaper({ warm, className = '', children, ...rest }: SmPaperProps) {
  return (
    <div className={`sm-paper ${warm ? 'sm-paper--warm' : ''} ${className}`} {...rest}>
      {children}
    </div>
  );
}

/** 全部传统色（供调色板展示 / 图表取色） */
export const SM_COLORS = [
  { name: '缥碧', key: 'piaobi', hex: '#c0d695', season: '木春' },
  { name: '青青', key: 'qingqing', hex: '#4f6f46', season: '木春' },
  { name: '翠虬', key: 'cuiqiu', hex: '#446a37', season: '木春' },
  { name: '青绶', key: 'qingshou', hex: '#284852', season: '木春' },
  { name: '青鸾', key: 'qingluan', hex: '#9aa7b1', season: '木春' },
  { name: '菘蓝', key: 'songlan', hex: '#6b798e', season: '木春' },
  { name: '青黛', key: 'qingdai', hex: '#45465e', season: '木春' },
  { name: '螺子黛', key: 'luozidai', hex: '#13393e', season: '木春' },
  { name: '麒麟', key: 'qiling', hex: '#12264f', season: '木春' },
  { name: '翠微', key: 'cuiwei', hex: '#4c8045', season: '木春' },
  { name: '庭芜绿', key: 'tingwulv', hex: '#68945c', season: '木春' },
  { name: '苍葭', key: 'cangjia', hex: '#a8bf8f', season: '木春' },
  { name: '黄栗留', key: 'huangliliu', hex: '#fedc5e', season: '木春' },
  { name: '栀子', key: 'zhizi', hex: '#fac03d', season: '木春' },
  { name: '朱颜酡', key: 'zhuyantuo', hex: '#f29a76', season: '火夏' },
  { name: '渥赭', key: 'wozhe', hex: '#dd6b7b', season: '火夏' },
  { name: '唇脂', key: 'chunzhi', hex: '#c25160', season: '火夏' },
  { name: '丹罽', key: 'danji', hex: '#e60012', season: '火夏' },
  { name: '大繎', key: 'daran', hex: '#a81c2b', season: '火夏' },
  { name: '绛纱', key: 'jiangsha', hex: '#b27777', season: '火夏' },
  { name: '夕岚', key: 'xilan', hex: '#e3adb9', season: '火夏' },
  { name: '缟羽', key: 'gaoyu', hex: '#efefef', season: '金秋' },
  { name: '玉色', key: 'yuse', hex: '#eae4d1', season: '金秋' },
  { name: '栾华', key: 'luanhua', hex: '#c0ad5e', season: '金秋' },
  { name: '杏子', key: 'xinzi', hex: '#da9233', season: '金秋' },
  { name: '靺鞈', key: 'moge', hex: '#9f5221', season: '金秋' },
  { name: '沉香', key: 'chenxiang', hex: '#99806c', season: '金秋' },
  { name: '蜜合', key: 'mihe', hex: '#dfd7c2', season: '金秋' },
  { name: '花青', key: 'huaqing', hex: '#1a2847', season: '金秋' },
  { name: '月白', key: 'yuebai', hex: '#d4e5ef', season: '水冬' },
  { name: '晴山', key: 'qingshan', hex: '#a3bbdb', season: '水冬' },
  { name: '紫苑', key: 'ziyuan', hex: '#757cbb', season: '水冬' },
  { name: '正青', key: 'zhengqing', hex: '#6ca8af', season: '水冬' },
  { name: '育阳染', key: 'yuyangran', hex: '#576470', season: '水冬' },
  { name: '京元', key: 'jingyuan', hex: '#31322c', season: '水冬' },
  { name: '驖骊', key: 'tieli', hex: '#46433b', season: '水冬' },
  { name: '獭见', key: 'tajian', hex: '#151d29', season: '水冬' },
  { name: '芥拾紫', key: 'jieshizi', hex: '#602641', season: '水冬' },
  { name: '石英', key: 'shiyin', hex: '#c8b6bb', season: '水冬' },
  { name: '逍遥游', key: 'xiaoyaoyou', hex: '#b2bfc3', season: '水冬' },
  { name: '黄梁', key: 'huangliang', hex: '#c4b798', season: '水冬' },
  { name: '檀褐', key: 'tanhe', hex: '#945635', season: '水冬' },
  { name: '吉金', key: 'jijin', hex: '#896d47', season: '水冬' },
  { name: '油葫芦', key: 'youhulu', hex: '#644d31', season: '水冬' },
] as const;
