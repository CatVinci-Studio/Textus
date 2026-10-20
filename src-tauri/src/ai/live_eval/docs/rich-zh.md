# 同步引擎笔记

## 状态

| 模块     | 负责人 | 状态   |
| -------- | ------ | ------ |
| 冲突合并 | 小米   | 评审中 |
| 搜索索引 | 阿汤   | 开发中 |
| 离线队列 | 安娜   | 已完成 |

## 实现

```js
// 计算平均回放耗时（毫秒）
function averageReplayTime(samples) {
  let total = 0;
  for (let i = 1; i < samples.length; i++) {
    total += samples[i];
  }
  return total / samples.length;
}
```

每个客户端在最近一次快照的基础上回放日志，所以打开文档的开销是 $O(n)$。