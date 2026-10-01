// ============================================================
// 小说流派目录 —— AI 写作新书向导的第二步（分类 → 细分流派）
//
// 为什么单独成文件：这份清单是**内容数据**，会经常增补，混在 AddBookModal 里
// 会让那个组件越来越难读。改清单只动这里，不动 UI。
//
// 分类口径（与 `@novel/shared` 的 GenreCategory 对应）：
//   · 系统流   —— 主角带系统 / 金手指：面板、任务、奖励、兑换，是推动力的来源
//   · 无系统流 —— 没有外挂装置：靠人物、世界规则与时代背景自己推
//
// 两边的组名尽量对齐（末日 / 都市 / 修炼 / 现实 / 悬疑 …），这样作者在同一组名
// 下横向对比「有系统」与「没系统」两种写法时，不需要重新建立心智地图。
// ============================================================

import type { GenreCategory } from '@novel/shared';

export interface GenreGroup {
  /** 分组名，如「末日天灾」 */
  group: string;
  /** 组内细分流派（单选） */
  options: string[];
}

export interface GenreCategoryDef {
  key: GenreCategory;
  label: string;
  /** 一句话说明「这一类的写法是什么」 */
  desc: string;
  groups: GenreGroup[];
}

export const GENRE_CATEGORIES: readonly GenreCategoryDef[] = [
  {
    key: 'system',
    label: '系统流',
    desc: '主角绑定系统 / 面板 / 金手指：任务、奖励、兑换与数值成长是故事的主推动力。',
    groups: [
      {
        group: '末日天灾',
        options: ['末日求生', '丧尸危机', '天灾末世', '废土重启', '冰河末世', '洪灾末世', '高温末世', '辐射禁区'],
      },
      {
        group: '都市系统',
        options: ['神豪系统', '签到系统', '直播系统', '反派系统', '文抄系统', '都市异能', '医疗系统', '美食系统'],
      },
      {
        group: '修炼升级',
        options: ['修仙系统', '玄幻升级', '灵气复苏', '游戏化世界', '武学加点', '副本刷宝', '丹药系统', '宗门崛起'],
      },
      {
        group: '穿越诸天',
        options: ['诸天万界', '万界穿梭', '综漫二次元', '影视同人', '历史穿越挂', '星际殖民', '神话降临', '时空回溯'],
      },
      {
        group: '模拟经营',
        options: ['人生模拟器', '轮回模拟器', '副本经营', '领地建设', '商城兑换', '数值面板流', '无限流闯关', '种田发育'],
      },
      {
        group: '悬疑诡异',
        options: ['规则怪谈', '诡异复苏', '恐怖直播', '密室求生', '副本惊悚', '身份谜题', '告示牌流', '克系系统'],
      },
    ],
  },
  {
    key: 'none',
    label: '无系统流',
    desc: '没有系统与金手指：靠人物关系、世界规则与时代洪流推动剧情的传统写法。',
    groups: [
      {
        group: '都市现实',
        options: ['都市日常', '都市异能', '商战职场', '校园青春', '文娱娱乐圈', '医生律政', '体育竞技', '市井群像'],
      },
      {
        group: '玄幻仙侠',
        options: ['东方玄幻', '修真仙侠', '洪荒神话', '武侠江湖', '剑修剑道', '凡人流', '符修丹修', '宗门恩怨'],
      },
      {
        group: '奇幻西幻',
        options: ['西幻骑士', '魔法学院', '剑与魔法', '异世界冒险', '蒸汽朋克', '克苏鲁诡秘', '精灵矮人', '兽人部落'],
      },
      {
        group: '科幻未来',
        options: ['星际战争', '太空歌剧', '机甲战场', '赛博朋克', '反乌托邦', '末世废土', '硬科幻', '时间旅行'],
      },
      {
        group: '历史军事',
        options: ['历史穿越', '争霸天下', '军事战争', '谍战特工', '架空历史', '三国权谋', '民国风云', '基建种田'],
      },
      {
        group: '悬疑推理',
        options: ['悬疑推理', '犯罪心理', '灵异惊悚', '盗墓探险', '民俗奇谈', '单元剧探案', '恐怖惊魂', '无限流生存'],
      },
      {
        group: '情感生活',
        options: ['言情甜宠', '虐恋深情', '校园恋爱', '婚恋日常', '古言宅斗', '宫斗权谋', '治愈日常', '群像史诗'],
      },
      {
        group: '特殊题材',
        options: ['轻小说风', '综影视同人', '二次元日常', '沙雕搞笑', '反套路', '群穿群像', '志怪奇谭', '广播剧向'],
      },
    ],
  },
];

/** 取分类定义（向导里按 key 查 label / 分组用） */
export function getGenreCategory(key: GenreCategory): GenreCategoryDef {
  return GENRE_CATEGORIES.find((c) => c.key === key) ?? GENRE_CATEGORIES[0]!;
}

/** 存进 `projects.genre` 的展示名（书卡顶部那个标签），如「系统流 · 末日求生」 */
export function formatGenreLabel(category: GenreCategory, genre: string): string {
  const label = getGenreCategory(category).label;
  return genre.trim() ? `${label} · ${genre.trim()}` : label;
}
