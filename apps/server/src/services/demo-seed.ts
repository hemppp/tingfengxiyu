// ============================================================
// Demo 数据种子 - 首次运行时自动注入示例项目
// ============================================================

import { schema, saveToDisk } from '@novel/db';
import type {
  Project, Chapter, Character, Item, Location,
  TimelineEvent, Foreshadow, StoryEvent, Note,
} from '@novel/shared';
import { v4 as uuidv4 } from 'uuid';

const DEMO_PROJECT_NAME = '青云之上';

export async function seedDemoData(userId: string): Promise<void> {
  const { getDb } = await import('@novel/db');
  const db = getDb();
  if (!db) {
    console.warn('[DemoSeed] 数据库不可用，跳过 Demo 数据注入');
    return;
  }

  const existing = db.select({ id: schema.projects.id })
    .from(schema.projects)
    .all();

  if (existing.length > 0) {
    console.debug('[DemoSeed] 已有项目，跳过 Demo 数据注入');
    return;
  }

  console.warn('[DemoSeed] 检测到空数据库，正在注入 Demo 示例数据...');

  const now = Date.now();
  const projectId = uuidv4();

  const project: Project = {
    id: projectId,
    userId,
    name: DEMO_PROJECT_NAME,
    description: '一部少年修仙问道的玄幻小说。主角林青云从一个偏远山村的平凡少年，意外获得上古传承，从此踏上波澜壮阔的修仙之路。',
    genre: '玄幻仙侠',
    penName: '墨尘',
    targetWordCount: 500000,
    currentWordCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  const chapters: Chapter[] = [];
  const characters: Character[] = [];
  const items: Item[] = [];
  const locations: Location[] = [];
  const timelineEvents: TimelineEvent[] = [];
  const foreshadows: Foreshadow[] = [];
  const storyEvents: StoryEvent[] = [];
  const notes: Note[] = [];

  const charIds: Record<string, string> = {};
  const itemIds: Record<string, string> = {};
  const locIds: Record<string, string> = {};

  function addChar(key: string, data: Omit<Character, 'id' | 'projectId' | 'createdAt' | 'updatedAt'>): string {
    const id = uuidv4();
    charIds[key] = id;
    characters.push({
      ...data,
      id,
      projectId,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  }

  function addItem(key: string, data: Omit<Item, 'id' | 'projectId' | 'createdAt' | 'updatedAt'>): string {
    const id = uuidv4();
    itemIds[key] = id;
    items.push({
      ...data,
      id,
      projectId,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  }

  function addLoc(key: string, data: Omit<Location, 'id' | 'projectId' | 'createdAt' | 'updatedAt'>): string {
    const id = uuidv4();
    locIds[key] = id;
    locations.push({
      ...data,
      id,
      projectId,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  }

  addChar('linqingyun', {
    name: '林青云',
    aliases: ['青云', '小林子', '青冥剑主'],
    role: 'protagonist',
    color: '#4F8EF7',
    desire: '追寻大道巅峰，守护身边之人',
    fear: '无力保护至亲之人',
    belief: '天道酬勤，我辈修士当自强不息',
    weakness: '过于重情，有时会因感情用事陷入险境',
    appearance: '身形挺拔，面容清秀，眉宇间带着一股坚韧之气。身穿青色道袍，腰悬古剑。',
    personality: '性格沉稳内敛，心思缜密，重情重义。面对敌人时杀伐果断，对待亲友时温柔体贴。',
    backstory: '出生于青牛镇的平凡少年，父母早亡，由村中老中医抚养长大。十六岁那年偶然获得上古青冥剑传承，从此踏上修仙之路。',
    speechStyle: '平时话语不多，但开口往往切中要害。激动时语速会加快，常用"我辈修士"作为口头禅。',
    states: [],
    relations: [],
    chapters: [1, 2, 3],
    tags: ['主角', '剑修', '青冥剑传承'],
  });

  addChar('suyan', {
    name: '苏颜',
    aliases: ['颜儿', '小师妹', '冰心仙子'],
    role: 'femaleLead',
    color: '#E91E63',
    desire: '摆脱家族联姻的命运，追求自己的道',
    fear: '被当作政治筹码，失去自由',
    belief: '女子亦可登顶大道之巅',
    weakness: '表面冷若冰霜，内心却极为敏感脆弱',
    appearance: '容貌绝世，肌肤胜雪，一头乌黑长发如瀑布般垂下。常着白衣，气质清冷如月下仙子。',
    personality: '外表高冷，内心炽热。不轻易相信他人，但一旦认定便会全心全意。天资聪颖，修炼刻苦。',
    backstory: '出身于修仙世家苏家，天生冰心玉骨，被家族寄予厚望。但因不愿接受家族安排的联姻，离家出走拜入青云宗。',
    speechStyle: '语气清冷简洁，惜字如金。偶尔流露真情时声音会变得轻柔。',
    states: [],
    relations: [],
    chapters: [2, 3],
    tags: ['女主', '冰心道体', '青云宗'],
  });

  addChar('mozun', {
    name: '血魔宗',
    aliases: ['老魔', '血河老祖'],
    role: 'supporting',
    color: '#D32F2F',
    desire: '突破魔尊境界，统一魔道',
    fear: '道心破碎，功亏一篑',
    belief: '力量即是真理，弱肉强食乃天道',
    weakness: '多疑嗜杀，终将众叛亲离',
    appearance: '面容枯槁，双目血光四射。身披血色长袍，周身萦绕着浓重的血腥味。',
    personality: '心狠手辣，诡计多端。为达目的不择手段，是正道人士的公敌。',
    backstory: '千年之前的魔道巨擘，曾横扫整个修仙界。后被七大宗门联手封印，如今封印松动，即将重出世间。',
    speechStyle: '声音沙哑刺耳，话语中充满邪气与嘲讽。',
    states: [],
    relations: [],
    chapters: [3],
    tags: ['反派', '魔道', '封印中'],
  });

  addChar('chenlao', {
    name: '陈老',
    aliases: ['陈大夫', '药老'],
    role: 'supporting',
    color: '#8BC34A',
    desire: '将林青云培养成人，报答故友之恩',
    fear: '林青云重蹈他父亲的覆辙',
    belief: '医者仁心，侠者大义',
    weakness: '年迈体衰，时日无多',
    appearance: '白发苍苍，面容慈祥，总是带着温和的笑容。身穿布衣，背着一个药篓。',
    personality: '和蔼可亲，睿智通透。看似平凡的老者，实则深藏不露。',
    backstory: '青牛镇的老中医，真实身份是退隐的修仙者。与林青云的父亲是至交好友，受故人之托抚养林青云长大。',
    speechStyle: '语气温和，语速缓慢，喜欢用比喻讲道理。',
    states: [],
    relations: [],
    chapters: [1],
    tags: ['导师', '医者', '退隐修士'],
  });

  addChar('zhaotian', {
    name: '赵天',
    aliases: ['赵师兄', '大师兄'],
    role: 'supporting',
    color: '#FF9800',
    desire: '成为青云宗宗主，光大门派',
    fear: '被后来者超越，失去大师兄的地位',
    belief: '实力决定一切，宗门利益高于个人',
    weakness: '心胸狭隘，嫉妒心强',
    appearance: '身材高大，相貌英俊，眉宇间带着傲气。身穿银边道袍，手持折扇。',
    personality: '骄傲自负，好胜心强。表面上风度翩翩，实则心胸狭窄，看不惯别人比自己优秀。',
    backstory: '青云宗宗主的亲传大弟子，天资出众，被视为下一代宗主人选。直到苏颜和林青云的出现，让他感到了威胁。',
    speechStyle: '说话时带着高人一等的语气，喜欢用反问句。',
    states: [],
    relations: [],
    chapters: [2, 3],
    tags: ['青云宗', '大师兄', '亦正亦邪'],
  });

  addItem('qingmingjian', {
    name: '青冥剑',
    type: '法宝',
    description: '上古青冥帝君的佩剑，蕴含无上剑道奥义。剑身通体青色，流转着淡淡的光华。看似平凡无奇，实则内藏乾坤。',
    color: '#4F8EF7',
    states: [
      { chapter: 1, field: '状态', newValue: '封印中', description: '林青云获得时，青冥剑处于深度封印状态' },
      { chapter: 3, field: '状态', oldValue: '封印中', newValue: '第一层解封', description: '遭遇血魔宗分身时，青冥剑自动解封第一层护主' },
    ],
    holders: [
      { characterId: 'linqingyun', chapter: 1, action: 'gained' },
    ],
    currentHolders: [],
    relations: [],
    chapters: [1, 2, 3],
    tags: ['本命法宝', '上古传承', '剑'],
  });

  addItem('bingxinpei', {
    name: '冰心佩',
    type: '信物',
    description: '苏颜的贴身玉佩，由冰心玉打磨而成，佩戴者可静心凝神，抵御心魔。玉佩上刻着一个"颜"字。',
    color: '#E91E63',
    states: [],
    holders: [
      { characterId: 'suyan', chapter: 2, action: 'gained' },
    ],
    currentHolders: [],
    relations: [],
    chapters: [2, 3],
    tags: ['玉佩', '防御', '苏家'],
  });

  addItem('xuanyan', {
    name: '玄炎丹',
    type: '丹药',
    description: '一种极其珍贵的筑基丹药，以玄火草为主药，辅以九种灵药炼制而成。服用者可大幅提升修为，突破瓶颈。',
    color: '#FF5722',
    states: [],
    holders: [
      { characterId: 'chenlao', chapter: 1, action: 'gained' },
      { characterId: 'linqingyun', chapter: 1, action: 'transferred' },
    ],
    currentHolders: [],
    relations: [],
    chapters: [1],
    tags: ['丹药', '筑基', '消耗品'],
  });

  addItem('xuehepan', {
    name: '血河幡',
    type: '法宝',
    description: '血魔宗的本命魔器，以十万生魂炼制而成。挥动时血浪滔天，吞噬一切生灵。被封印后威力大减。',
    color: '#D32F2F',
    states: [],
    holders: [
      { characterId: 'mozun', chapter: 3, action: 'gained' },
    ],
    currentHolders: [],
    relations: [],
    chapters: [3],
    tags: ['魔器', '血河', '邪门'],
  });

  addItem('qingyunling', {
    name: '青云令',
    type: '令牌',
    description: '青云宗的入门令牌，代表着弟子的身份。令牌正面刻有青云二字，背面是弟子的编号。',
    color: '#4CAF50',
    states: [],
    holders: [
      { characterId: 'linqingyun', chapter: 2, action: 'gained' },
      { characterId: 'suyan', chapter: 2, action: 'gained' },
      { characterId: 'zhaotian', chapter: 2, action: 'gained' },
    ],
    currentHolders: [],
    relations: [],
    chapters: [2, 3],
    tags: ['身份令牌', '青云宗', '入门'],
  });

  addItem('guyaoshu', {
    name: '古医书',
    type: '书籍',
    description: '陈老珍藏的上古医书，记载着无数失传的丹方和医术。书页泛黄，字迹娟秀，似乎出自女子之手。',
    color: '#795548',
    states: [],
    holders: [
      { characterId: 'chenlao', chapter: 1, action: 'gained' },
    ],
    currentHolders: [],
    relations: [],
    chapters: [1],
    tags: ['医书', '传承', '上古'],
  });

  addLoc('qingniuzhen', {
    name: '青牛镇',
    description: '一个位于青云山脉脚下的偏远小镇。民风淳朴，以采药和狩猎为生。镇子里只有几十户人家，林青云在这里长大。',
    color: '#8BC34A',
    world: '人界',
    states: [],
    chapters: [1],
    tags: ['小镇', '起点', '凡间'],
  });

  addLoc('qingyunshan', {
    name: '青云山脉',
    description: '连绵千里的巨大山脉，云雾缭绕，灵气充沛。传说中有仙人在此修行，故而得名。山脉深处隐藏着无数秘密和危险。',
    color: '#4F8EF7',
    world: '人界',
    states: [],
    chapters: [1, 2],
    tags: ['山脉', '灵地', '神秘'],
  });

  addLoc('qingyunzong', {
    name: '青云宗',
    description: '正道七大宗门之一，坐落于青云山脉主峰之上。宗门建筑依山而建，层层叠叠，气势恢宏。弟子数千，高手如云。',
    color: '#2196F3',
    world: '人界',
    states: [],
    chapters: [2, 3],
    tags: ['宗门', '正道', '七大派'],
  });

  addLoc('xuehedong', {
    name: '血河洞',
    description: '位于青云山脉深处的一处禁地，传说中血魔宗被封印之地。洞内血色河流奔涌，魔气冲天，常人靠近便会心神失守。',
    color: '#D32F2F',
    world: '人界',
    states: [
      { chapter: 3, field: '封印', newValue: '松动', description: '千年封印逐渐减弱，魔气开始外泄' },
    ],
    chapters: [3],
    tags: ['禁地', '魔道', '封印'],
  });

  addLoc('yaocao', {
    name: '药草谷',
    description: '青云山脉中的一处隐秘山谷，生长着各种珍稀灵药。陈老常带着林青云来此采药。',
    color: '#4CAF50',
    world: '人界',
    states: [],
    chapters: [1],
    tags: ['山谷', '灵药', '隐蔽'],
  });

  /* eslint-disable no-irregular-whitespace -- 以下 demo 正文使用全角空格 U+3000 作中文段落缩进（排版惯例） */
  const chapter1Content = `<p>　　青牛镇的清晨，总是被山间的雾气笼罩着。</p>
<p>　　林青云背着药篓，跟在陈老身后，沿着蜿蜒的山路向药草谷走去。十六岁的少年身形已经挺拔，只是面容还带着几分青涩。</p>
<p>　　"青云啊，"陈老忽然开口，声音慢悠悠的，"你跟着我学医，也有十年了吧。"</p>
<p>　　"回陈爷爷，是十年了。"林青云恭敬地回答，"当年要不是您收留我，我早就饿死在街头了。"</p>
<p>　　陈老停下脚步，转过身看着眼前的少年，浑浊的双眼中闪过一丝复杂的神色："你父亲当年救过我的命，我照顾你是应该的。只是......"</p>
<p>　　"只是什么？"林青云不解地问。</p>
<p>　　陈老摇了摇头，从怀中掏出一个古朴的木盒，递给林青云："你今年十六了，有些东西，也该交给你了。这是你父亲留下的，他说等你十六岁生日那天再给你。"</p>
<p>　　林青云接过木盒，入手微凉。盒子上刻着繁复的花纹，看起来年代久远。他轻轻打开盒子，里面静静地躺着一把三寸长的小剑，通体青色，看起来毫不起眼。</p>
<p>　　"这是......"林青云疑惑地抬起头。</p>
<p>　　"你父亲说，这是林家祖传的东西。"陈老叹了口气，"具体是什么，我也不知道。你贴身收好，不要让别人看到。"</p>
<p>　　林青云点了点头，将小剑贴身收好。他能感觉到，那把小剑贴在胸口时，传来一阵温温的感觉，似乎有什么东西在里面沉睡着。</p>
<p>　　就在这时，远处传来一声巨响，整座山都跟着晃了晃。</p>
<p>　　"什么声音？"林青云吓了一跳。</p>
<p>　　陈老的脸色瞬间变得凝重起来，他望向青云山脉深处，低声道："不好......封印......"</p>
<p>　　话音未落，一股磅礴的魔气从山脉深处冲天而起，血色的光芒染红了半边天空。</p>
<p>　　林青云只觉得胸口一热，那把青色小剑突然散发出耀眼的光芒。</p>`;

  const chapter2Content = `<p>　　青云宗，山门之前。</p>
<p>　　林青云站在巨大的石牌坊下，仰望着上面"青云宗"三个大字，心中充满了震撼。</p>
<p>　　三天前，青云山脉深处的异动惊动了整个修仙界。陈老带着林青云连夜赶路，将他送到了青云宗。</p>
<p>　　"陈爷爷，您真的不跟我一起上去吗？"林青云依依不舍地问。</p>
<p>　　陈老摇了摇头，慈祥地笑了笑："我一把老骨头了，就不上去凑热闹了。青云，记住我说的话，好好修炼，照顾好自己。"</p>
<p>　　"嗯！"林青云用力点头，眼眶微微泛红。</p>
<p>　　陈老从怀中取出一个瓷瓶，塞到林青云手里："这里面有三枚玄炎丹，关键时刻能救命。收好，不要轻易示人。"</p>
<p>　　交代完一切，陈老转身离去，步履蹒跚，却走得很坚定。</p>
<p>　　林青云站在原地，目送着陈老的身影消失在山路尽头，才深吸一口气，转身走向青云宗的山门。</p>
<p>　　山门前，一个身穿银边道袍的青年正站在那里，脸上带着傲慢的神色。看到林青云走来，他皱了皱眉："你就是陈前辈推荐的人？"</p>
<p>　　"在下林青云，见过师兄。"林青云拱手行礼。</p>
<p>　　"我是赵天，"青年微微昂起下巴，"宗主让我来接引你。跟我来吧，先去测一下灵根。"</p>
<p>　　林青云跟在赵天身后，沿着石阶向上走去。一路上，他看到了不少和自己年纪相仿的少年少女，都是来参加入门考核的。</p>
<p>　　"喂，赵师兄！"一个清脆的声音从旁边传来。</p>
<p>　　林青云转头看去，只见一个白衣少女正站在不远处。少女容貌绝世，气质清冷，宛如月下仙子。只是那眉宇间，带着一丝淡淡的忧愁。</p>
<p>　　赵天看到少女，脸上的傲慢瞬间变成了笑容："苏师妹，你怎么在这里？"</p>
<p>　　"我来看看今年的新弟子。"少女的声音清冷如冰玉相击，目光落在林青云身上，"这位是......？"</p>
<p>　　"他叫林青云，是陈前辈推荐来的。"赵天介绍道，语气中带着一丝不易察觉的嫉妒，"林青云，这位是苏颜苏师妹，冰心道体，可是我们青云宗百年不遇的天才。"</p>
<p>　　"苏师姐好。"林青云连忙行礼。</p>
<p>　　苏颜微微颔首，目光在林青云身上停留了片刻，似乎察觉到了什么，眼中闪过一丝讶异。但她什么也没说，转身飘然离去。</p>
<p>　　看着苏颜的背影，赵天的眼神阴沉了几分。他转头看向林青云，冷冷地道："走吧，别耽误时间了。"</p>
<p>　　林青云没有注意到赵天的变化，他还在回想着刚才苏颜看他的眼神。那眼神中，似乎有什么他看不懂的东西。</p>
<p>　　而他胸口处，那把青色小剑，在苏颜靠近的时候，微微颤动了一下。</p>`;

  const chapter3Content = `<p>　　夜色如墨，明月高悬。</p>
<p>　　林青云盘坐在自己的房间里，按照陈老教给他的吐纳之法运转着体内的灵气。</p>
<p>　　来到青云宗已经一个月了，他顺利通过了入门考核，成为了一名外门弟子。只是他的灵根资质只是普通的四灵根，在一众天才中毫不起眼。</p>
<p>　　但只有林青云自己知道，他的修炼速度一点都不慢。因为每当他运转功法的时候，胸口那把青色小剑就会散发出丝丝缕缕的清凉气息，融入他的经脉之中，让他的修炼速度事半功倍。</p>
<p>　　"这把剑到底是什么来头......"林青云心中暗想。</p>
<p>　　就在这时，他突然感觉到一阵心悸，仿佛有什么可怕的东西正在靠近。</p>
<p>　　林青云猛地睁开眼睛，只见窗外的天空不知何时已经变成了血红色。一股浓重的血腥味，弥漫在空气中。</p>
<p>　　"血河洞的封印......"林青云喃喃自语，他想起了陈老临走前跟他说过的话。</p>
<p>　　尖锐的警报声突然响彻整个青云宗，无数道剑光从各处升起，向着山脉深处飞去。</p>
<p>　　"所有弟子听令！血河洞封印松动，魔道妖人即将出世！内门弟子随长老前去支援，外门弟子留守宗门！"</p>
<p>　　林青云心中一紧，他想要去帮忙，可是他知道，以他现在的修为，去了也只是送死。</p>
<p>　　就在他犹豫的时候，一道血色的光芒突然从天际坠落，直直地向着外门弟子居住区砸来！</p>
<p>　　"小心！"</p>
<p>　　一声清叱响起，苏颜的身影出现在半空之中。她双手结印，一面冰墙凭空出现，挡在了那道血光前面。</p>
<p>　　"轰！"</p>
<p>　　剧烈的爆炸声响起，冰墙瞬间破碎。苏颜闷哼一声，倒飞了出去。</p>
<p>　　血光散去，一个浑身浴血的人影出现在半空之中。那人面容枯槁，双目血光四射，正是血魔宗的一道分身！</p>
<p>　　"桀桀桀......青云宗的小娃娃，没想到还有冰心道体。"血魔宗分身发出刺耳的笑声，"正好，抓你回去做我的鼎炉！"</p>
<p>　　说着，他大手一挥，一只血色大手向着苏颜抓去。</p>
<p>　　苏颜脸色苍白，想要抵抗，却已经力不从心。</p>
<p>　　就在这千钧一发之际，林青云动了。</p>
<p>　　他不知道自己哪里来的勇气，只是下意识地冲了出去。胸口的青色小剑，在这一刻爆发出耀眼的青色光芒。</p>
<p>　　"嗡——"</p>
<p>　　一声清越的剑鸣声响起，一把青色长剑从林青云体内飞出，悬在他的身前。剑身流转着神秘的符文，散发出一股让人心悸的威压。</p>
<p>　　"青冥剑？！"血魔宗分身的脸色骤然一变，声音中带着难以置信的惊恐，"不可能！青冥帝君不是已经......"</p>
<p>　　话音未落，青冥剑化作一道青色长虹，向着血魔宗分身斩去！</p>
<p>　　"啊——！"</p>
<p>　　血魔宗分身发出一声惨叫，被青色剑光一斩为二，化作漫天血雨消散。</p>
<p>　　青冥剑在空中盘旋了一圈，重新飞回林青云体内，再次陷入沉寂。</p>
<p>　　林青云站在原地，大口大口地喘着粗气。刚才那一剑，几乎抽干了他全身的灵力。</p>
<p>　　苏颜落在地上，怔怔地看着林青云，美目中充满了震惊。</p>
<p>　　月光下，少年的身影虽然略显单薄，却给人一种莫名的安全感。</p>
<p>　　而在遥远的血河洞深处，一个沉睡了千年的存在，缓缓睁开了眼睛。</p>
<p>　　"青冥剑......没想到时隔千年，又出现了......"</p>
<p>　　（第三章完）</p>`;
  /* eslint-enable no-irregular-whitespace */

  const wc1 = chapter1Content.replace(/<[^>]+>/g, '').replace(/\s/g, '').length;
  const wc2 = chapter2Content.replace(/<[^>]+>/g, '').replace(/\s/g, '').length;
  const wc3 = chapter3Content.replace(/<[^>]+>/g, '').replace(/\s/g, '').length;

  chapters.push({
    id: uuidv4(),
    projectId,
    title: '第一章 青牛镇少年',
    content: chapter1Content,
    order: 1,
    wordCount: wc1,
    summary: '林青云与陈老上山采药，意外获得父亲留下的青色小剑。与此同时，青云山脉深处封印松动，魔气冲天。',
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  });

  chapters.push({
    id: uuidv4(),
    projectId,
    title: '第二章 初入青云宗',
    content: chapter2Content,
    order: 2,
    wordCount: wc2,
    summary: '林青云拜入青云宗，结识了大师兄赵天和天才少女苏颜。苏颜似乎察觉到了林青云身上的不同寻常。',
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  });

  chapters.push({
    id: uuidv4(),
    projectId,
    title: '第三章 青冥剑现',
    content: chapter3Content,
    order: 3,
    wordCount: wc3,
    summary: '血河洞封印松动，血魔宗分身袭击青云宗。危急时刻，林青云体内的青冥剑自动解封，斩杀强敌。',
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  });

  items.find(i => i.name === '青冥剑')!.currentHolders = [charIds['linqingyun']];
  items.find(i => i.name === '冰心佩')!.currentHolders = [charIds['suyan']];
  items.find(i => i.name === '玄炎丹')!.currentHolders = [charIds['linqingyun']];
  items.find(i => i.name === '血河幡')!.currentHolders = [charIds['mozun']];
  items.find(i => i.name === '青云令')!.currentHolders = [charIds['linqingyun'], charIds['suyan'], charIds['zhaotian']];
  items.find(i => i.name === '古医书')!.currentHolders = [charIds['chenlao']];

  const charLin = characters.find(c => c.name === '林青云')!;
  const charSu = characters.find(c => c.name === '苏颜')!;
  const charZhao = characters.find(c => c.name === '赵天')!;
  const charChen = characters.find(c => c.name === '陈老')!;

  charLin.relations = [
    { targetId: charSu.id, type: '挚友', description: '并肩作战的伙伴，彼此心生情愫', chapter: 3, direction: 'mutual' },
    { targetId: charChen.id, type: '祖孙', description: '陈老抚养林青云长大，情同祖孙', chapter: 1, direction: 'to' },
    { targetId: charZhao.id, type: '对手', description: '赵天嫉妒林青云的天赋', chapter: 2, direction: 'from' },
  ];

  charSu.relations = [
    { targetId: charLin.id, type: '挚友', description: '对林青云有着特殊的感觉', chapter: 3, direction: 'mutual' },
  ];

  charZhao.relations = [
    { targetId: charLin.id, type: '对手', description: '视林青云为竞争对手', chapter: 2, direction: 'to' },
    { targetId: charSu.id, type: '倾慕', description: '对苏颜有好感，但对方不以为意', chapter: 2, direction: 'from' },
  ];

  let tlOrder = 1;
  function addTimeline(data: Omit<TimelineEvent, 'id' | 'projectId' | 'order' | 'createdAt' | 'updatedAt'>) {
    timelineEvents.push({
      ...data,
      id: uuidv4(),
      projectId,
      order: tlOrder++,
      createdAt: now,
      updatedAt: now,
    });
  }

  addTimeline({
    title: '林青云获得青冥剑',
    description: '陈老将林父遗留的木盒交给林青云，里面藏着青冥剑的剑胎。',
    chapter: 1,
    timestamp: '第一天 清晨',
    characterIds: [charIds['linqingyun'], charIds['chenlao']],
    type: 'event',
    color: '#4F8EF7',
  });

  addTimeline({
    title: '血河封印松动',
    description: '青云山脉深处传来巨响，血魔宗的封印出现裂痕，魔气冲天。',
    chapter: 1,
    timestamp: '第一天 正午',
    characterIds: [charIds['mozun']],
    type: 'foreshadow',
    color: '#D32F2F',
  });

  addTimeline({
    title: '拜入青云宗',
    description: '陈老将林青云送到青云宗，林青云正式成为修仙弟子。',
    chapter: 2,
    timestamp: '第四天 上午',
    characterIds: [charIds['linqingyun'], charIds['chenlao']],
    type: 'event',
    color: '#4CAF50',
  });

  addTimeline({
    title: '初遇苏颜',
    description: '林青云在青云宗山门前偶遇苏颜，青冥剑微微颤动。',
    chapter: 2,
    timestamp: '第四天 中午',
    characterIds: [charIds['linqingyun'], charIds['suyan']],
    type: 'event',
    color: '#E91E63',
  });

  addTimeline({
    title: '赵天的嫉妒',
    description: '赵天注意到苏颜对林青云的关注，心中升起嫉妒之意。',
    chapter: 2,
    timestamp: '第四天 下午',
    characterIds: [charIds['zhaotian']],
    type: 'state_change',
    color: '#FF9800',
  });

  addTimeline({
    title: '血魔宗分身来袭',
    description: '血魔宗分身突破封印，袭击青云宗外门。',
    chapter: 3,
    timestamp: '第三十四天 深夜',
    characterIds: [charIds['mozun']],
    type: 'event',
    color: '#D32F2F',
  });

  addTimeline({
    title: '苏颜负伤',
    description: '苏颜为保护外门弟子硬撼血魔宗分身，身受重伤。',
    chapter: 3,
    timestamp: '第三十四天 深夜',
    characterIds: [charIds['suyan']],
    type: 'state_change',
    color: '#E91E63',
  });

  addTimeline({
    title: '青冥剑解封',
    description: '危急关头，青冥剑自动解封第一层，斩杀血魔宗分身。',
    chapter: 3,
    timestamp: '第三十四天 深夜',
    characterIds: [charIds['linqingyun']],
    type: 'state_change',
    color: '#4F8EF7',
  });

  addTimeline({
    title: '血魔宗苏醒',
    description: '血河洞深处，沉睡千年的血魔宗本尊感知到青冥剑的气息，缓缓苏醒。',
    chapter: 3,
    timestamp: '第三十四天 深夜',
    characterIds: [charIds['mozun']],
    type: 'foreshadow',
    color: '#D32F2F',
  });

  foreshadows.push({
    id: uuidv4(),
    projectId,
    description: '林青云的父亲身份成谜，他究竟是什么人？为何会有青冥剑这样的上古神器？',
    type: 'identity',
    status: 'planted',
    seedChapter: 1,
    seedText: '这是你父亲留下的，他说等你十六岁生日那天再给你。',
    hints: [
      { chapter: 1, text: '你父亲当年救过我的命' },
    ],
    relatedCharacters: [charIds['linqingyun'], charIds['chenlao']],
    relatedItems: [itemIds['qingmingjian']],
    relatedEvents: [],
    earmarks: [],
    tags: ['身世之谜', '青冥帝君'],
    createdAt: now,
    updatedAt: now,
  });

  foreshadows.push({
    id: uuidv4(),
    projectId,
    description: '苏颜与青冥剑之间似乎有着某种神秘的联系，她靠近时青冥剑会微微颤动。',
    type: 'relation',
    status: 'planted',
    seedChapter: 2,
    seedText: '苏颜的目光在林青云身上停留了片刻，似乎察觉到了什么，眼中闪过一丝讶异。',
    hints: [
      { chapter: 2, text: '那眼神中，似乎有什么他看不懂的东西。' },
    ],
    relatedCharacters: [charIds['linqingyun'], charIds['suyan']],
    relatedItems: [itemIds['qingmingjian']],
    relatedEvents: [],
    earmarks: [],
    tags: ['宿命', '前世今生'],
    createdAt: now,
    updatedAt: now,
  });

  foreshadows.push({
    id: uuidv4(),
    projectId,
    description: '血魔宗与青冥帝君之间有着千年前的恩怨，这次青冥剑现世，必将引来血魔宗的疯狂报复。',
    type: 'fate',
    status: 'hinted',
    seedChapter: 1,
    seedText: '血河洞的封印......',
    hints: [
      { chapter: 1, text: '封印......松动......' },
      { chapter: 3, text: '青冥帝君不是已经......' },
    ],
    payoffChapter: 3,
    payoffText: '青冥剑......没想到时隔千年，又出现了......',
    relatedCharacters: [charIds['mozun'], charIds['linqingyun']],
    relatedItems: [itemIds['qingmingjian'], itemIds['xuehepan']],
    relatedEvents: [],
    earmarks: [],
    tags: ['千年恩怨', '宿命对决'],
    createdAt: now,
    updatedAt: now,
  });

  foreshadows.push({
    id: uuidv4(),
    projectId,
    description: '陈老的真实身份不简单，他不仅认识林青云的父亲，还和青云宗有着千丝万缕的联系。',
    type: 'identity',
    status: 'planted',
    seedChapter: 2,
    seedText: '陈前辈推荐来的。',
    hints: [
      { chapter: 1, text: '你父亲当年救过我的命' },
      { chapter: 2, text: '是陈前辈推荐来的' },
    ],
    relatedCharacters: [charIds['chenlao'], charIds['linqingyun']],
    relatedItems: [itemIds['guyaoshu']],
    relatedEvents: [],
    earmarks: [],
    tags: ['隐世高人', '身份之谜'],
    createdAt: now,
    updatedAt: now,
  });

  storyEvents.push({
    id: uuidv4(),
    projectId,
    title: '青冥剑初现',
    description: '林青云在血魔宗分身的威胁下，激发了青冥剑的力量，斩杀强敌。这是他修仙路上的第一个重要转折点。',
    chapter: 3,
    participants: [charIds['linqingyun'], charIds['suyan'], charIds['mozun']],
    relatedItems: [itemIds['qingmingjian']],
    relatedLocations: [locIds['qingyunzong']],
    consequences: [
      '青冥剑第一层封印解开',
      '苏颜对林青云产生好奇',
      '血魔宗感知到青冥剑的存在',
      '青云宗高层开始注意到林青云',
    ],
    tags: ['战斗', '转折点', '神器觉醒'],
    createdAt: now,
    updatedAt: now,
  });

  notes.push({
    id: uuidv4(),
    projectId,
    title: '世界观设定',
    content: `# 修仙境界划分\n\n炼气 → 筑基 → 金丹 → 元婴 → 化神 → 炼虚 → 合体 → 大乘 → 渡劫 → 仙人\n\n每一大境界分为初期、中期、后期、巅峰四个小境界。\n\n# 七大正道宗门\n\n1. 青云宗 - 剑修为主，位于青云山脉\n2. 天衍宗 - 阵法符箓\n3. 药王谷 - 丹道医术\n4. 御兽宗 - 驯兽之道\n5. 玄冰阁 - 冰属性功法\n6. 雷音寺 - 佛门功法\n7. 天机阁 - 占卜推演\n\n# 魔道势力\n\n血河宗 - 血河幡，血河老祖\n白骨门 - 骷髅白骨\n合欢派 - 采补之术\n鬼修联盟 - 鬼道法术`,
    tags: ['设定', '世界观', '境界'],
    pinned: true,
    createdAt: now,
    updatedAt: now,
  });

  notes.push({
    id: uuidv4(),
    projectId,
    title: '后续剧情大纲',
    content: `# 第一卷 青云初鸣（第1-50章）\n\n- 林青云在青云宗稳步成长\n- 苏颜逐渐对林青云产生好感\n- 赵天不断给林青云制造麻烦\n- 外门大比，林青云一鸣惊人\n- 进入内门，拜入某位长老门下\n\n# 第二卷 秘境探险（第51-150章）\n\n- 林青云获得更多机缘\n- 揭开部分身世之谜\n- 与苏颜感情升温\n- 遭遇血魔宗余孽\n\n# 第三卷 血魔风云（第151-300章）\n\n- 血魔宗大举入侵\n- 青云宗陷入危机\n- 林青云力挽狂澜\n- 揭开苏颜身世之谜\n- 与血魔老祖决战\n\n# 第四卷 仙界飞升（第301-500章）\n\n- 林青云渡劫飞升\n- 初入仙界立足\n- 探索上古秘辛\n- 与各方势力周旋\n- 终成一代剑仙`,
    tags: ['大纲', '剧情'],
    pinned: false,
    createdAt: now,
    updatedAt: now,
  });

  // 写入主库 projects 表
  db.insert(schema.projects).values({
    id: project.id,
    userId: project.userId,
    name: project.name,
    description: project.description ?? null,
    genre: project.genre ?? null,
    penName: project.penName ?? null,
    targetWordCount: project.targetWordCount ?? null,
    currentWordCount: project.currentWordCount ?? 0,
    createdAt: new Date(project.createdAt),
    updatedAt: new Date(project.updatedAt),
  }).run();

  // 写入项目级表（每本书独立 SQLite 文件）
  const { initProjectDb, getProjectDbSync } = await import('@novel/db');
  await initProjectDb(projectId);
  const projectDb = getProjectDbSync(projectId);
  if (!projectDb) {
    console.error('[DemoSeed] 项目库初始化失败');
    return;
  }

  // 插入章节（顺序写入，order 从 1 开始）
  for (const ch of chapters) {
    (projectDb as unknown as {
      insert: (table: unknown) => { values: (data: unknown) => { run: () => void } };
    }).insert(schema.chapters).values({
      id: ch.id,
      projectId: ch.projectId,
      title: ch.title,
      content: ch.content ?? '',
      order: ch.order,
      wordCount: ch.wordCount ?? 0,
      summary: ch.summary ?? null,
      status: ch.status ?? 'draft',
      label: ch.label ?? null,
      pov: ch.pov ?? null,
      createdAt: ch.createdAt,
      updatedAt: ch.updatedAt,
    }).run();
  }

  // 插入角色
  for (const c of characters) {
    (projectDb as unknown as {
      insert: (table: unknown) => { values: (data: unknown) => { run: () => void } };
    }).insert(schema.characters).values({
      id: c.id,
      projectId: c.projectId,
      name: c.name,
      aliases: c.aliases ? JSON.stringify(c.aliases) : null,
      thumbnail: c.thumbnail ?? null,
      color: c.color ?? null,
      role: c.role ?? null,
      desire: c.desire ?? null,
      fear: c.fear ?? null,
      belief: c.belief ?? null,
      weakness: c.weakness ?? null,
      appearance: c.appearance ?? null,
      personality: c.personality ?? null,
      backstory: c.backstory ?? null,
      speechStyle: c.speechStyle ?? null,
      states: c.states ? JSON.stringify(c.states) : null,
      relations: c.relations ? JSON.stringify(c.relations) : null,
      chapters: c.chapters ? JSON.stringify(c.chapters) : null,
      tags: c.tags ? JSON.stringify(c.tags) : null,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }).run();
  }

  // 插入物品
  for (const it of items) {
    (projectDb as unknown as {
      insert: (table: unknown) => { values: (data: unknown) => { run: () => void } };
    }).insert(schema.items).values({
      id: it.id,
      projectId: it.projectId,
      name: it.name,
      type: it.type ?? null,
      description: it.description ?? null,
      thumbnail: it.thumbnail ?? null,
      color: it.color ?? null,
      states: it.states ? JSON.stringify(it.states) : null,
      holders: it.holders ? JSON.stringify(it.holders) : null,
      currentHolders: it.currentHolders ? JSON.stringify(it.currentHolders) : null,
      relations: it.relations ? JSON.stringify(it.relations) : null,
      chapters: it.chapters ? JSON.stringify(it.chapters) : null,
      tags: it.tags ? JSON.stringify(it.tags) : null,
      createdAt: it.createdAt,
      updatedAt: it.updatedAt,
    }).run();
  }

  // 插入地点
  for (const loc of locations) {
    (projectDb as unknown as {
      insert: (table: unknown) => { values: (data: unknown) => { run: () => void } };
    }).insert(schema.locations).values({
      id: loc.id,
      projectId: loc.projectId,
      name: loc.name,
      description: loc.description ?? null,
      thumbnail: loc.thumbnail ?? null,
      color: loc.color ?? null,
      latitude: loc.latitude ?? null,
      longitude: loc.longitude ?? null,
      mapZoom: loc.mapZoom ?? null,
      world: loc.world ?? null,
      states: loc.states ? JSON.stringify(loc.states) : null,
      chapters: loc.chapters ? JSON.stringify(loc.chapters) : null,
      tags: loc.tags ? JSON.stringify(loc.tags) : null,
      createdAt: loc.createdAt,
      updatedAt: loc.updatedAt,
    }).run();
  }

  // 插入故事事件
  for (const ev of storyEvents) {
    (projectDb as unknown as {
      insert: (table: unknown) => { values: (data: unknown) => { run: () => void } };
    }).insert(schema.storyEvents).values({
      id: ev.id,
      projectId: ev.projectId,
      title: ev.title,
      description: ev.description ?? null,
      chapter: ev.chapter,
      participants: ev.participants ? JSON.stringify(ev.participants) : null,
      relatedItems: ev.relatedItems ? JSON.stringify(ev.relatedItems) : null,
      relatedLocations: ev.relatedLocations ? JSON.stringify(ev.relatedLocations) : null,
      consequences: ev.consequences ? JSON.stringify(ev.consequences) : null,
      tags: ev.tags ? JSON.stringify(ev.tags) : null,
      createdAt: ev.createdAt,
      updatedAt: ev.updatedAt,
    }).run();
  }

  // 插入笔记
  for (const note of notes) {
    (projectDb as unknown as {
      insert: (table: unknown) => { values: (data: unknown) => { run: () => void } };
    }).insert(schema.notes).values({
      id: note.id,
      projectId: note.projectId,
      title: note.title ?? null,
      content: note.content ?? '',
      tags: note.tags ? JSON.stringify(note.tags) : null,
      pinned: note.pinned ?? false,
      linkedChapterId: note.linkedChapterId ?? null,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    }).run();
  }

  await saveToDisk();

  console.log(`[demo-seed] 完成: ${chapters.length} 章节 / ${characters.length} 角色 / ${items.length} 物品 / ${locations.length} 地点 / ${storyEvents.length} 事件 / ${notes.length} 笔记`);
}