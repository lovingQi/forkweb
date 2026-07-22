import type { IssueType } from '../types';

interface ClassifierInput {
  rootCauseIds?: string[];
  rootCauseTitles?: string[];
  errorCodes?: string[];
  modules?: string[];
  knowledgeTags?: string[];
}

const ISSUE_KEYWORDS: Record<IssueType, string[]> = {
  positioning: ['定位', 'localization', 'loc_score', 'lost', 'pose', 'position', 'amcl', 'slam'],
  laser: ['激光', 'laser', 'radar', 'lidar', 'scan', 'ERROR05', 'ERROR06'],
  obstacle_avoidance: ['避障', 'obstacle', 'avoidance', 'collision', 'safety', 'estop', '防撞条', '挡板'],
  map: ['地图', 'map', 'params', 'config', 'configure error', '参数', '配置'],
  task_failure: ['任务', 'task', 'path', 'route', 'mission'],
  charging: ['充电', 'charge', 'battery', 'power', '低电量'],
  hardware_communication: ['设备', 'hardware', 'communication', 'timeout', 'offline', '串口', 'can', 'imu', 'odometry'],
  fork_sensor: ['货叉', 'fork', '传感器', 'sensor', 'loaded'],
  unknown: []
};

function scoreIssueType(type: IssueType, input: ClassifierInput): number {
  const keywords = ISSUE_KEYWORDS[type];
  let score = 0;

  const textSources = [
    ...(input.rootCauseIds || []),
    ...(input.rootCauseTitles || []),
    ...(input.knowledgeTags || [])
  ];
  for (const text of textSources) {
    const lower = text.toLowerCase();
    for (const kw of keywords) {
      if (lower.includes(kw.toLowerCase())) score += 1;
    }
  }

  for (const code of input.errorCodes || []) {
    const upper = code.toUpperCase();
    if (type === 'laser' && /^ERROR05\d{2}$/.test(upper)) score += 2;
    if (type === 'hardware_communication' && /^ERROR06\d{2}$/.test(upper)) score += 2;
    if (type === 'obstacle_avoidance' && /^ERROR01\d{2}$/.test(upper)) score += 1;
  }

  for (const mod of input.modules || []) {
    const lower = mod.toLowerCase();
    for (const kw of keywords) {
      if (lower.includes(kw.toLowerCase())) score += 1;
    }
  }

  return score;
}

export function classifyIssueType(input: ClassifierInput): IssueType {
  const candidates: IssueType[] = [
    'positioning',
    'laser',
    'obstacle_avoidance',
    'map',
    'task_failure',
    'charging',
    'hardware_communication',
    'fork_sensor'
  ];

  let best: IssueType = 'unknown';
  let bestScore = 0;
  for (const type of candidates) {
    const score = scoreIssueType(type, input);
    if (score > bestScore) {
      bestScore = score;
      best = type;
    }
  }
  return best;
}

export function classifyFromAnalysis(data: {
  rootCauses?: Array<{ id?: string; title?: string; knowledgeRuleId?: string }>;
  knowledgeMatches?: Array<{ tags?: string[]; ruleId?: string; title?: string }>;
  errorSummaries?: Array<{ code?: string; modules?: string[] }>;
}): IssueType {
  const rootCauseIds = (data.rootCauses || []).map((c) => c.id || '').filter(Boolean);
  const rootCauseTitles = (data.rootCauses || []).map((c) => c.title || '').filter(Boolean);
  const errorCodes = (data.errorSummaries || []).map((s) => s.code || '').filter(Boolean);
  const modules = (data.errorSummaries || []).flatMap((s) => s.modules || []);
  const knowledgeTags = (data.knowledgeMatches || []).flatMap((m) => m.tags || []);

  return classifyIssueType({
    rootCauseIds,
    rootCauseTitles,
    errorCodes,
    modules,
    knowledgeTags
  });
}
