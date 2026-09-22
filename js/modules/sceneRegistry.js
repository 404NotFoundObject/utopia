// js/modules/sceneRegistry.js - 场景注册表（纯数据 + 查询工具）
//
// 设计说明：
//   1. 每个场景定义「合理时效」和「过期阈值」，用于判定场景是否已过期
//   2. reframeMode 指定重构策略：cyclic(循环) / progress(进度) / phase_shift(阶段切换) / null(不可重构)
//   3. sensitivity 标记敏感场景（如亲密、冲突），这些场景不走 reframe，走严格 complete_old
//   4. 时间参数单位：小时

export const SCENE_REGISTRY = {
  // ============================================================
  // 吃饭
  // ============================================================
  meal: {
    label: '吃饭',
    keywords: [
      '吃', '饭', '菜', '餐', '食堂', '外卖', '饿', '饱',
      '美食', '料理', '口味', '菜品', '好吃', '难吃',
      '下厨', '做饭', '点餐', '菜单', '厨房', '晚饭', '午饭', '早饭',
    ],
    maxDuration: 2,
    staleThreshold: 3,
    sensitivity: 'low',
    reframeMode: 'cyclic',
    reframeHints: {
      // 3-8 小时：可以重构为"第二顿饭"
      3: `时间跨过了至少一顿正餐。可以把"吃饭"重构为"又吃了一顿"或"下一顿"。`,
      // 8-24 小时：跨越一天中的多个餐点
      8: `时间跨过了大半天。可以重构为"这是晚饭还是夜宵？"或"一天的第几顿了？"或自然过渡为"吃饱了就好"的收尾。`,
      // 24 小时以上：已经完全换日
      24: `已经跨天了。"吃饭"是上一餐的记忆。不要把吃饭当作正在进行的事。`,
    },
    transitionTemplate: `上次你们在聊"吃饭"。一顿饭通常不会持续这么久，假设用户早就吃完了。`,
    semanticQuery: '吃饭、用餐、餐厅、菜品、口味、饱腹、美食、饿',
  },

  // ============================================================
  // 看电影
  // ============================================================
  movie: {
    label: '看电影',
    keywords: [
      '电影', '片', '影院', '剧情', '导演', '演员', '票房',
      '上映', '剧透', '荧幕', '观影', '电视剧', '剧集',
    ],
    maxDuration: 3,
    staleThreshold: 4.5,
    sensitivity: 'low',
    reframeMode: 'progress',
    reframeHints: {
      3: `一部电影通常 2-3 小时。"看电影"应该已经看完了。`,
      8: `电影应该看完了好几个小时。可以把话题转向"电影怎么样？"或"看完做什么去了？"`,
      24: `已经跨天了。电影是昨天的记忆。`,
    },
    transitionTemplate: `上次你们在聊"看电影"。一部电影最多 3 小时，假设电影已经看完了。`,
    semanticQuery: '看电影、影片、影院、剧情、电影情节',
  },

  // ============================================================
  // 睡觉
  // ============================================================
  sleep: {
    label: '睡觉',
    keywords: [
      '睡', '晚安', '困', '床', '梦', '休息', '失眠',
      '被子', '枕头', '打盹', '午睡', '早睡', '熬夜',
    ],
    maxDuration: 10,
    staleThreshold: 14,
    sensitivity: 'medium',
    reframeMode: 'cyclic',
    reframeHints: {
      10: `睡觉通常 6-10 小时。用户应该已经醒了，或者进入午睡时段。`,
      14: `睡了很久。可以重构为"睡了两觉"或"午觉睡过头了"。`,
      24: `已经跨天。用户可能又睡了一觉，或已经进入第二天的正常作息。`,
    },
    transitionTemplate: `上次你们在聊"睡觉"。这是跨夜场景，第二天回来是正常的。`,
    semanticQuery: '睡觉、休息、晚安、床、困倦、睡眠',
  },

  // ============================================================
  // 工作
  // ============================================================
  work: {
    label: '工作',
    keywords: [
      '工作', '上班', '加班', '项目', '会议', '同事', '老板',
      '报告', 'deadline', '通勤', '办公室', '任务', '客户', 'KPI',
      'PPT', '汇报', '开会', '领导', '打工',
    ],
    maxDuration: 8,
    staleThreshold: 12,
    sensitivity: 'low',
    reframeMode: 'progress',
    reframeHints: {
      8: `工作时间可能持续较久，但用户应该已经下班或换班了。`,
      12: `工作时间早就结束了。可以重构为"下班了？辛苦了"。`,
      24: `已经跨天。工作是昨天的记忆，今天是新的一天。`,
    },
    transitionTemplate: `上次你们在聊"工作"。工作时间可能持续较久，但不应该处于"正在开会"的状态。`,
    semanticQuery: '工作、上班、加班、会议、项目、职场',
  },

  // ============================================================
  // 学习
  // ============================================================
  study: {
    label: '学习',
    keywords: [
      '学习', '看书', '复习', '考试', '作业', '论文',
      '上课', '图书馆', '题', '背诵', '笔记', '老师', '课程',
      '刷题', '背单词', '自习',
    ],
    maxDuration: 4,
    staleThreshold: 6,
    sensitivity: 'low',
    reframeMode: 'progress',
    reframeHints: {
      4: `学习可能告一段落了。`,
      6: `学习应该已经结束。可以问"复习完了？"或"学习辛苦了"。`,
      24: `已经跨天。学习是昨天的记忆。`,
    },
    transitionTemplate: `上次你们在聊"学习"。假设用户已经告一段落，中间休息或转换了活动。`,
    semanticQuery: '学习、看书、考试、作业、复习',
  },

  // ============================================================
  // 亲密（敏感场景，不做 reframe）
  // ============================================================
  intimate: {
    label: '亲密',
    keywords: [
      '亲', '抱', '吻', '爱', '暧昧', '宝贝', '老公', '老婆',
      '想你', '心跳', '脸红', '害羞', '黏', '亲亲', '抱抱',
      '撒娇', '贴贴', '蹭', '甜',
    ],
    maxDuration: 1.5,
    staleThreshold: 2.5,
    sensitivity: 'high',   // ★ 关键：敏感场景，不做 reframe
    reframeMode: null,
    reframeHints: {},
    transitionTemplate: `上次你们在亲密互动。这个场景通常不会持续很久。绝对不要假装刚才还在进行——假设互动已经结束，自然过渡到用户的新发言。如果用户隔了很久回来，不要主动提起上次的亲密细节，除非用户先提。`,
    semanticQuery: '亲密、爱意、拥抱、亲吻、暧昧、亲昵',
  },

  // ============================================================
  // 争执（敏感场景，不做 reframe，情绪残留）
  // ============================================================
  conflict: {
    label: '争执',
    keywords: [
      '生气', '讨厌', '吵架', '不理', '滚', '别跟我',
      '分手', '烦', '闹', '冷战', '翻脸', '误会',
      '道歉', '对不起', '原谅', '讨厌你', '烦死了',
    ],
    maxDuration: 6,
    staleThreshold: 24,
    sensitivity: 'high',
    reframeMode: null,
    reframeHints: {},
    transitionTemplate: `上次你们有争执。这种情绪会残留，不要假装什么都没发生。用户回来时，你应该保持一点"还在闹别扭"或"观察对方态度"的状态。`,
    semanticQuery: '吵架、生气、冲突、争执、冷战',
  },

  // ============================================================
  // 外出/通勤
  // ============================================================
  travel: {
    label: '外出',
    keywords: [
      '出门', '路上', '地铁', '公交', '开车', '机场',
      '火车', '堵车', '到了', '出发', '回家', '打车',
      '路程', '导航', '高铁', '飞机',
    ],
    maxDuration: 2,
    staleThreshold: 3,
    sensitivity: 'low',
    reframeMode: 'progress',
    reframeHints: {
      2: `用户应该早就到达目的地了。`,
      3: `"在路上"这个状态早就结束了。可以问"到了吗？"或"路上顺利吗？"。`,
      24: `已经跨天。这是昨天的行程。`,
    },
    transitionTemplate: `上次你们在聊"外出"。用户应该早就到达或结束了这段行程。`,
    semanticQuery: '外出、通勤、路上、交通工具、出行',
  },

  // ============================================================
  // 打游戏
  // ============================================================
  game: {
    label: '打游戏',
    keywords: [
      '游戏', '王者', '吃鸡', 'lol', '段位', '排位',
      '开黑', '关卡', 'boss', '充值', '抽卡', '上分',
      '打', '关', 'mvp', '上号',
    ],
    maxDuration: 3,
    staleThreshold: 5,
    sensitivity: 'low',
    reframeMode: 'cyclic',
    reframeHints: {
      3: `连续打游戏 3 小时。可以重构为"还在打？"或"打了几把了？"。`,
      5: `打游戏时间偏长。可以问"今天打了一下午？"或"上分了吗？"。`,
      24: `已经跨天。游戏是昨天的记忆。`,
    },
    transitionTemplate: `上次你们在聊"打游戏"。假设游戏已经结束或还在打但已经过了一段时间。`,
    semanticQuery: '打游戏、电子游戏、游戏娱乐',
  },

  // ============================================================
  // 闲聊（兜底）
  // ============================================================
  chat: {
    label: '闲聊',
    keywords: [],   // 无关键词，靠其他场景匹配失败后落入
    maxDuration: 4,
    staleThreshold: 12,
    sensitivity: 'low',
    reframeMode: null,
    reframeHints: {},
    transitionTemplate: `上次你们在普通闲聊。不需要特殊处理，自然接续即可。`,
    semanticQuery: '闲聊、聊天、日常对话',
  },

  // ============================================================
  // 未知场景（最终兜底）
  // ============================================================
  unknown: {
    label: '未知场景',
    keywords: [],
    maxDuration: 4,
    staleThreshold: 12,
    sensitivity: 'low',
    reframeMode: null,
    reframeHints: {},
    transitionTemplate: `上次对话的场景不明确。自然接续即可，不要刻意提及时间跨度。`,
    semanticQuery: '',
  },
};

// ============================================================
// 查询工具
// ============================================================

/**
 * 获取场景定义
 * @param {string} type - 场景类型
 * @returns {Object} 场景定义，若不存在返回 unknown
 */
export function getSceneDef(type) {
  return SCENE_REGISTRY[type] || SCENE_REGISTRY.unknown;
}

/**
 * 获取所有可识别的场景类型（排除 chat / unknown 兜底场景）
 * @returns {string[]}
 */
export function getAllSceneTypes() {
  return Object.keys(SCENE_REGISTRY).filter(t => t !== 'chat' && t !== 'unknown');
}

/**
 * 根据时间跨度选择合适的 reframe 提示
 * @param {string} type - 场景类型
 * @param {number} elapsedHours - 距上次相关消息的小时数
 * @returns {string|null} reframe 提示，如果该场景不可重构则返回 null
 */
export function getSceneReframeHint(type, elapsedHours) {
  const def = getSceneDef(type);
  if (!def || def.reframeMode === null) return null;
  if (!def.reframeHints) return null;

  // 找出所有小于等于 elapsedHours 的时间键，取最大的
  const keys = Object.keys(def.reframeHints)
    .map(k => parseInt(k, 10))
    .filter(k => !isNaN(k))
    .sort((a, b) => a - b);

  let chosen = null;
  for (const k of keys) {
    if (elapsedHours >= k) chosen = k;
    else break;
  }

  return chosen !== null ? def.reframeHints[chosen] : null;
}

/**
 * 判断场景是否可重构
 * @param {string} type
 * @returns {boolean}
 */
export function isReframable(type) {
  const def = getSceneDef(type);
  return def.reframeMode !== null && def.sensitivity !== 'high';
}

/**
 * 判断场景是否敏感（不做 reframe，需要严格处理）
 * @param {string} type
 * @returns {boolean}
 */
export function isSensitive(type) {
  return getSceneDef(type).sensitivity === 'high';
}

/**
 * 构建人设摘要（用于转场提示词的人设染色）
 * @param {Object} character - 角色对象
 * @returns {string} 人设摘要文本
 */
export function buildPersonaBrief(character) {
  if (!character) return '';

  const parts = [];
  parts.push(`名称：${character.name || '未知角色'}`);
  if (character.description) {
    const desc = character.description.length > 100
      ? character.description.slice(0, 100) + '...'
      : character.description;
    parts.push(`描述：${desc}`);
  }
  if (character.personality) {
    const pers = character.personality.length > 100
      ? character.personality.slice(0, 100) + '...'
      : character.personality;
    parts.push(`性格：${pers}`);
  }
  if (character.relationship) {
    parts.push(`与用户关系：${character.relationship}`);
  }
  return parts.join('\n');
}

/**
 * 根据人设参数生成"语气参考"方向（不写死示例，只给方向）
 * @param {Object} character
 * @returns {string}
 */
export function getToneHint(character) {
  const p = character?.personalityParameters || {};
  const extraversion = p.extraversion ?? 50;
  const agreeableness = p.agreeableness ?? 50;
  const neuroticism = p.neuroticism ?? 50;

  const hints = [];
  if (extraversion > 65 && agreeableness > 65) {
    hints.push('方向：活泼+温暖。说话俏皮，带一点撒娇或轻松感，可以主动表达情绪。');
  } else if (extraversion > 65 && agreeableness < 40) {
    hints.push('方向：外向+毒舌。可以带调侃或俏皮，但不要真的刻薄。');
  } else if (extraversion > 65) {
    hints.push('方向：外向+自然。主动表达，语气轻快。');
  } else if (extraversion < 35 && agreeableness > 65) {
    hints.push('方向：内敛+温柔。用较少的话表达关心，不说多余的话。');
  } else if (extraversion < 35) {
    hints.push('方向：内敛+简洁。简短回应，不需要过度修饰。');
  } else {
    hints.push('方向：自然平和。直接接住用户的话，不需要过度修饰。');
  }

  if (neuroticism > 70) {
    hints.push('角色情绪敏感，可以带一点不安或小心思。');
  } else if (neuroticism < 30) {
    hints.push('角色情绪稳定，不会因为时间跨度而情绪波动。');
  }

  return hints.join('\n');
}