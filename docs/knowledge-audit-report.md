# 诊断知识库审计报告

- 生成时间: 2026-07-21T02:01:35.435Z
- 规则总数: 64
- 通过: 64
- 失败: 0
- 样本已验证: 1
- 结构已保护: 60
- 待验证: 3

| 规则 | 启用 | 验证状态 | 结果 | 问题 |
|---|---:|---|---|---|
| 激光无数据 | 是 | sample_verified | 通过 | - |
| 里程计数据超时 | 是 | structure_guarded | 通过 | - |
| 陀螺仪数据超时 | 是 | structure_guarded | 通过 | - |
| 主激光数据超时 | 是 | structure_guarded | 通过 | - |
| 左侧激光数据超时 | 是 | structure_guarded | 通过 | - |
| 右侧激光数据超时 | 是 | structure_guarded | 通过 | - |
| 尾叉激光数据超时 | 是 | structure_guarded | 通过 | - |
| 顶部深度相机数据超时 | 是 | structure_guarded | 通过 | - |
| 底部深度相机数据超时 | 是 | structure_guarded | 通过 | - |
| 定位丢失 | 是 | structure_guarded | 通过 | - |
| 充电异常 | 是 | structure_guarded | 通过 | - |
| 地图文件读取失败 | 是 | structure_guarded | 通过 | - |
| 路径生成失败 | 是 | structure_guarded | 通过 | - |
| 目标点不可达 | 是 | structure_guarded | 通过 | - |
| 车辆初始位置不在路径上 | 是 | structure_guarded | 通过 | - |
| 托盘检测异常 | 是 | structure_guarded | 通过 | - |
| 货物装载失败 | 是 | structure_guarded | 通过 | - |
| 挡板状态异常/货物脱落 | 是 | structure_guarded | 通过 | - |
| 遇到障碍物 | 是 | structure_guarded | 通过 | - |
| 货叉动作超时 | 是 | structure_guarded | 通过 | - |
| 硬急停导致货叉中断 | 是 | structure_guarded | 通过 | - |
| 地图中不存在当前路径点 | 是 | structure_guarded | 通过 | - |
| 重定位前位置距起点太远 | 是 | structure_guarded | 通过 | - |
| 重定位失败：定位效果不佳 | 是 | structure_guarded | 通过 | - |
| 地图中不存在重定位目标点 | 是 | structure_guarded | 通过 | - |
| 路径不可达 | 是 | structure_guarded | 通过 | - |
| 手动充电中无法控制 | 是 | structure_guarded | 通过 | - |
| 地图中不存在起点坐标 | 是 | structure_guarded | 通过 | - |
| 地图中不存在目标点坐标 | 是 | structure_guarded | 通过 | - |
| 路径点坐标序列为空 | 是 | structure_guarded | 通过 | - |
| 路径生成失败(任务级) | 是 | structure_guarded | 通过 | - |
| 机器人初始位置不在路径上 | 是 | structure_guarded | 通过 | - |
| 直线行走横向偏差过大 | 是 | structure_guarded | 通过 | - |
| 当前位置距离起点太远 | 是 | structure_guarded | 通过 | - |
| 原地动作前距起点太远 | 是 | structure_guarded | 通过 | - |
| 相机无法识别到栈板 | 是 | structure_guarded | 通过 | - |
| 货叉已抬升但挡板未触发 | 是 | structure_guarded | 通过 | - |
| 取货时只触发一个挡板 | 是 | structure_guarded | 通过 | - |
| 取货时挡板未触发 | 是 | structure_guarded | 通过 | - |
| 取货时货叉未抬升 | 是 | structure_guarded | 通过 | - |
| 已有货物无法重复装货 | 是 | structure_guarded | 通过 | - |
| 取货前低位挡板已触发 | 是 | structure_guarded | 通过 | - |
| 起步时插齿高位无货 | 是 | structure_guarded | 通过 | - |
| 充电点无对应PathPoint | 是 | structure_guarded | 通过 | - |
| 充电通信超时 | 是 | structure_guarded | 通过 | - |
| 充电信号丢失 | 是 | structure_guarded | 通过 | - |
| 地图数据读取失败 | 是 | structure_guarded | 通过 | - |
| 原地旋转耗时过长 | 是 | structure_guarded | 通过 | - |
| 行驶中货叉掉高 | 是 | structure_guarded | 通过 | - |
| 扫码相机未启用 | 是 | structure_guarded | 通过 | - |
| 扫码识别失败 | 是 | structure_guarded | 通过 | - |
| 扫码超时 | 是 | structure_guarded | 通过 | - |
| 复位失败 | 是 | structure_guarded | 通过 | - |
| 前方避障停车 | 是 | structure_guarded | 通过 | - |
| 后方避障停车 | 是 | structure_guarded | 通过 | - |
| 侧方避障停车 | 是 | structure_guarded | 通过 | - |
| 急停触发 | 是 | structure_guarded | 通过 | - |
| 防撞条触发 | 是 | structure_guarded | 通过 | - |
| 叉齿光电触发 | 是 | structure_guarded | 通过 | - |
| 速度过零异常 | 否 | pending | 通过 | - |
| 安全避障功能关闭 | 是 | structure_guarded | 通过 | - |
| 低电量告警 | 是 | structure_guarded | 通过 | - |
| 满载限速 | 否 | pending | 通过 | - |
| 高位限速 | 否 | pending | 通过 | - |
