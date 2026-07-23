import { createKnowledgeRule, readKnowledgeLibraryWithHits } from '../src/core/knowledgeBase';
import type { KnowledgeRule } from '../src/types';

interface SeedRuleInput extends Partial<KnowledgeRule> {
  title: string;
}

const seedRules: SeedRuleInput[] = [
  {
    title: '参数文件缺失',
    description: '日志中出现 Params 文件 does not exist，导致定位或任务参数加载失败。',
    rootCause: '车辆参数文件缺失或路径配置错误。',
    solution: '检查 /opt/robot/params 目录，补齐缺失的 JSON/YAML 参数文件；重启后重新建单验证。',
    severity: 'warning',
    tags: ['参数', '启动失败'],
    enabled: true,
    verificationStatus: 'sample_verified',
    publicationStatus: 'verified',
    pattern: {
      requiredKeywords: ['does not exist'],
      anyKeywords: ['Params', 'params', 'parameter'],
      modules: ['JParams', 'mg_main'],
      confidenceBase: 0.75,
      windowSeconds: 10,
      minOccurrences: 1
    },
    guideSteps: [
      { stepNo: 1, title: '检查参数目录', stepType: 'readonly_check', isCritical: true, instruction: '登录车辆，检查 /opt/robot/params 下是否存在对应参数文件。' },
      { stepNo: 2, title: '补齐缺失参数', stepType: 'field_operation', isCritical: false, instruction: '从备份或同类车辆复制缺失参数文件到对应目录，完成后重启车辆。' }
    ]
  },
  {
    title: '定位丢失（LOC_LOST）',
    description: '激光匹配分数持续低于阈值，车辆报定位丢失。',
    rootCause: '地图与实际环境差异大、激光遮挡或反光干扰。',
    solution: '检查激光洁净度与安装位置，确认地图区域无变化；必要时重新采集地图或调整激光ROI。',
    severity: 'error',
    tags: ['定位', '激光'],
    enabled: true,
    verificationStatus: 'sample_verified',
    publicationStatus: 'verified',
    pattern: {
      requiredKeywords: ['LOC_LOST', 'loc_score'],
      anyKeywords: ['localization', 'score'],
      modules: ['loc', 'laser'],
      confidenceBase: 0.8,
      windowSeconds: 10,
      minOccurrences: 2
    },
    guideSteps: [
      { stepNo: 1, title: '检查激光窗口', stepType: 'readonly_check', isCritical: true, instruction: '查看激光点云，确认无大量遮挡或反光物。' },
      { stepNo: 2, title: '清洁激光雷达', stepType: 'field_operation', isCritical: false, instruction: '擦拭激光雷达窗口，确保无灰尘、水渍。' },
      { stepNo: 3, title: '确认地图一致性', stepType: 'readonly_check', isCritical: true, instruction: '对比当前环境与地图，确认货架/墙体未发生变化。' }
    ]
  },
  {
    title: '任务路径规划失败',
    description: '系统无法为任务生成可行路径，任务无法执行。',
    rootCause: '目标点被障碍物占用、地图拓扑断开或路径约束过严。',
    solution: '清除路径障碍物，检查目标点可用性；必要时放宽路径约束或重新标定站点。',
    severity: 'error',
    tags: ['任务', '路径规划'],
    enabled: true,
    verificationStatus: 'sample_verified',
    publicationStatus: 'verified',
    pattern: {
      requiredKeywords: ['path', 'plan', 'failed'],
      anyKeywords: ['route', 'task', 'planning'],
      modules: ['mg_task', 'path_planner'],
      confidenceBase: 0.7,
      windowSeconds: 15,
      minOccurrences: 1
    },
    guideSteps: [
      { stepNo: 1, title: '检查目标站点', stepType: 'readonly_check', isCritical: true, instruction: '确认目标站点无货物、人员或其他车辆占用。' },
      { stepNo: 2, title: '查看地图拓扑', stepType: 'readonly_check', isCritical: false, instruction: '在地图编辑器中确认起点到终点存在可通行边。' }
    ]
  },
  {
    title: '充电对接失败',
    description: '车辆到达充电桩后无法成功对接充电。',
    rootCause: '充电口机械偏移、电极脏污或充电站点位姿偏差。',
    solution: '清洁充电电极，微调充电站点位姿；检查充电桩供电状态。',
    severity: 'warning',
    tags: ['充电', '对接'],
    enabled: true,
    verificationStatus: 'sample_verified',
    publicationStatus: 'verified',
    pattern: {
      requiredKeywords: ['charge', 'dock'],
      anyKeywords: ['failed', 'timeout', 'contact'],
      modules: ['charge', 'mg_main'],
      confidenceBase: 0.72,
      windowSeconds: 20,
      minOccurrences: 1
    },
    guideSteps: [
      { stepNo: 1, title: '检查电极接触', stepType: 'field_operation', isCritical: true, instruction: '确认车辆充电电极与充电桩电极无污物、无变形。' },
      { stepNo: 2, title: '重新标定站点', stepType: 'rd_required', isCritical: false, instruction: '由研发调整充电站点位姿，重新下发任务验证。' }
    ]
  },
  {
    title: '货叉传感器异常',
    description: '货叉高度、负载检测传感器信号异常。',
    rootCause: '传感器接线松动、货叉机构卡滞或传感器损坏。',
    solution: '检查传感器接线与固定状态，手动升降货叉确认机械顺畅；更换故障传感器。',
    severity: 'error',
    tags: ['货叉', '传感器', '硬件'],
    enabled: true,
    verificationStatus: 'sample_verified',
    publicationStatus: 'verified',
    pattern: {
      requiredKeywords: ['fork', 'sensor'],
      anyKeywords: ['height', 'load', 'error'],
      modules: ['fork', 'io'],
      confidenceBase: 0.74,
      windowSeconds: 10,
      minOccurrences: 1
    },
    guideSteps: [
      { stepNo: 1, title: '检查接线和固定', stepType: 'field_operation', isCritical: true, instruction: '检查货叉传感器接线是否松动、固定是否可靠。' },
      { stepNo: 2, title: '手动测试货叉', stepType: 'field_operation', isCritical: false, instruction: '在安全模式下手动升降货叉，确认无卡滞。' }
    ]
  },
  {
    title: '避障区域触发急停',
    description: '车辆在无障碍区域频繁触发安全激光避障急停。',
    rootCause: '安全激光安装角度偏移、反射干扰或避障参数设置过严。',
    solution: '检查安全激光安装角度，清理反射物；由研发调整避障距离参数。',
    severity: 'error',
    tags: ['避障', '安全', '急停'],
    enabled: true,
    verificationStatus: 'sample_verified',
    publicationStatus: 'verified',
    pattern: {
      requiredKeywords: ['safety', 'estop'],
      anyKeywords: ['obstacle', 'avoidance', 'laser'],
      modules: ['safety', 'avoid'],
      confidenceBase: 0.78,
      windowSeconds: 10,
      minOccurrences: 2
    },
    guideSteps: [
      { stepNo: 1, title: '检查安全激光窗口', stepType: 'readonly_check', isCritical: true, instruction: '查看安全激光点云，确认无固定反射物造成误触发。' },
      { stepNo: 2, title: '清洁并紧固激光', stepType: 'field_operation', isCritical: false, instruction: '清洁安全激光窗口，确认安装支架无松动。' },
      { stepNo: 3, title: '调整避障参数', stepType: 'rd_required', isCritical: false, instruction: '由研发在配置界面适度放宽避障距离并验证。' }
    ]
  },
  {
    title: '通信模块离线',
    description: '车辆与调度系统或 PLC 通信中断。',
    rootCause: '网线松动、交换机故障或通信进程崩溃。',
    solution: '检查网络连接与指示灯，重启通信进程；排查交换机/PLC状态。',
    severity: 'error',
    tags: ['通信', '网络', 'PLC'],
    enabled: true,
    verificationStatus: 'sample_verified',
    publicationStatus: 'verified',
    pattern: {
      requiredKeywords: ['communication', 'offline', 'disconnect'],
      anyKeywords: ['PLC', 'network', 'ethernet'],
      modules: ['comm', 'mg_main'],
      confidenceBase: 0.7,
      windowSeconds: 10,
      minOccurrences: 1
    },
    guideSteps: [
      { stepNo: 1, title: '检查物理连接', stepType: 'field_operation', isCritical: true, instruction: '确认车辆网线、交换机指示灯正常。' },
      { stepNo: 2, title: '重启通信进程', stepType: 'rd_required', isCritical: false, instruction: '由研发远程重启通信模块并确认心跳恢复。' }
    ]
  },
  {
    title: '电机驱动告警',
    description: '驱动器报告过流、过热或编码器异常。',
    rootCause: '电机负载过大、驱动器散热不良或编码器接线松动。',
    solution: '检查电机与驱动器温度，确认机械无卡滞；紧固编码器接线，必要时更换驱动器。',
    severity: 'error',
    tags: ['电机', '驱动', '硬件'],
    enabled: true,
    verificationStatus: 'sample_verified',
    publicationStatus: 'verified',
    pattern: {
      requiredKeywords: ['motor', 'driver'],
      anyKeywords: ['overcurrent', 'overheat', 'encoder', 'alarm'],
      modules: ['motor', 'drive'],
      confidenceBase: 0.76,
      windowSeconds: 10,
      minOccurrences: 1
    },
    guideSteps: [
      { stepNo: 1, title: '检查驱动器状态灯', stepType: 'readonly_check', isCritical: true, instruction: '查看驱动器数码管/指示灯，记录告警代码。' },
      { stepNo: 2, title: '检查电机温度与机械', stepType: 'field_operation', isCritical: false, instruction: '手触电机确认不过热，检查车轮/链条无卡滞。' }
    ]
  },
  {
    title: '地图加载失败',
    description: '启动时无法加载指定地图文件。',
    rootCause: '地图文件缺失、损坏或路径配置错误。',
    solution: '确认地图文件存在于 /opt/robot/maps，重新上传或修复地图；检查 config 中地图名。',
    severity: 'warning',
    tags: ['地图', '启动'],
    enabled: true,
    verificationStatus: 'sample_verified',
    publicationStatus: 'verified',
    pattern: {
      requiredKeywords: ['map', 'load'],
      anyKeywords: ['failed', 'not found', 'missing'],
      modules: ['map', 'mg_main'],
      confidenceBase: 0.72,
      windowSeconds: 10,
      minOccurrences: 1
    },
    guideSteps: [
      { stepNo: 1, title: '检查地图文件', stepType: 'readonly_check', isCritical: true, instruction: '登录车辆确认 /opt/robot/maps 下存在目标地图文件。' },
      { stepNo: 2, title: '重新上传地图', stepType: 'rd_required', isCritical: false, instruction: '由研发重新上传地图并校验文件完整性。' }
    ]
  },
  {
    title: '电池电量低',
    description: '车辆电池电量低于安全阈值，无法继续执行任务。',
    rootCause: '电池老化、充电不足或长时间未回充。',
    solution: '手动将车辆开至充电桩充电；如电池老化严重，联系更换电池。',
    severity: 'warning',
    tags: ['电池', '充电'],
    enabled: true,
    verificationStatus: 'sample_verified',
    publicationStatus: 'verified',
    pattern: {
      requiredKeywords: ['battery', 'low'],
      anyKeywords: ['voltage', 'power', 'charge'],
      modules: ['power', 'mg_main'],
      confidenceBase: 0.68,
      windowSeconds: 10,
      minOccurrences: 1
    },
    guideSteps: [
      { stepNo: 1, title: '查看电量百分比', stepType: 'readonly_check', isCritical: true, instruction: '在监控页面确认当前电量与电压。' },
      { stepNo: 2, title: '手动充电', stepType: 'field_operation', isCritical: false, instruction: '将车辆驶至充电桩并启动充电。' }
    ]
  },
  {
    title: '软件版本不匹配',
    description: '车辆软件版本与调度协议版本不一致，导致通信异常。',
    rootCause: '升级后未同步更新车辆端或协议版本字段不一致。',
    solution: '核对车辆与调度系统版本号，按升级手册统一回退或同步升级。',
    severity: 'error',
    tags: ['软件', '版本'],
    enabled: true,
    verificationStatus: 'sample_verified',
    publicationStatus: 'verified',
    pattern: {
      requiredKeywords: ['version', 'mismatch'],
      anyKeywords: ['protocol', ' incompatible', 'upgrade'],
      modules: ['comm', 'mg_main'],
      confidenceBase: 0.74,
      windowSeconds: 10,
      minOccurrences: 1
    },
    guideSteps: [
      { stepNo: 1, title: '记录版本号', stepType: 'readonly_check', isCritical: true, instruction: '在日志中提取车辆软件版本与调度协议版本。' },
      { stepNo: 2, title: '统一升级或回退', stepType: 'rd_required', isCritical: false, instruction: '由研发确认版本兼容性并执行统一升级或回退。' }
    ]
  },
  {
    title: '急停按钮被按下',
    description: '车辆处于急停状态，所有运动被禁止。',
    rootCause: '人员误触急停按钮或安全回路断开。',
    solution: '检查并复位所有急停按钮，确认安全回路闭合后重新上电使能。',
    severity: 'error',
    tags: ['安全', '急停'],
    enabled: true,
    verificationStatus: 'sample_verified',
    publicationStatus: 'verified',
    pattern: {
      requiredKeywords: ['EStop', 'estop', 'emergency'],
      anyKeywords: ['pressed', 'stop', 'safety'],
      modules: ['safety', 'io'],
      confidenceBase: 0.8,
      windowSeconds: 10,
      minOccurrences: 1
    },
    guideSteps: [
      { stepNo: 1, title: '检查所有急停按钮', stepType: 'field_operation', isCritical: true, instruction: '绕车一周，确认所有急停按钮均已复位。' },
      { stepNo: 2, title: '重新上电使能', stepType: 'field_operation', isCritical: false, instruction: '复位完成后重新上电并确认状态指示灯正常。' }
    ]
  }
];

async function main() {
  const library = await readKnowledgeLibraryWithHits();
  const existingTitles = new Set(library.rules.map((r) => r.title));
  let created = 0;
  let skipped = 0;

  for (const input of seedRules) {
    if (existingTitles.has(input.title)) {
      console.log(`[seed] 已存在，跳过: ${input.title}`);
      skipped++;
      continue;
    }
    const rule = await createKnowledgeRule(input);
    console.log(`[seed] 已创建: ${rule.title} (${rule.id})`);
    created++;
  }

  console.log(`\n[seed] 完成: 创建 ${created} 条，跳过 ${skipped} 条，总计 ${created + skipped} 条。`);
}

main().catch((e) => {
  console.error('[seed] 失败:', e);
  process.exit(1);
});
