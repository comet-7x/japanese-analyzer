# 虚拟角色服务收尾验收（2026-10-21）

本轮按“反馈与恢复 → 循环与目录性能 → 模型与可访问性 → 生产构建 → 清理”的顺序推进。代码完成和实机验收分别记录；本报告不等于所有平台已通过。

## 已交付批次

| 批次 | 提交 | 结果 |
| --- | --- | --- |
| 反馈与恢复 | `6b0749e` | 伴学表情可选事件结束恢复；命中区域／重叠优先级反馈；三类规则来源；修改数量和角色应用摘要 |
| 循环与性能 | `43617e9` | 动作完成后续播，停止／切换取消；目录每页最多 50 条，全目录搜索和用途索引 |
| 模型与可访问性修复 | `759b275` | 资源标签跨筛选稳定；设置和嵌套窗口焦点限制、恢复；侧栏方向键；减少动态效果时暂停自动待机与视线跟随，保留显式预览和朗读唤醒 |

## 已实际验证

### 官方真实模型

临时下载 [Live2D 官方 Haru 样例](https://github.com/Live2D/CubismWebSamples/tree/develop/Samples/Resources/Haru)，含 6 个动作、8 个表情及头／身体区域。模型、纹理和 Core 未加入版本库。

Chrome 的文件上传被扩展的本地文件访问权限阻挡；未修改扩展安全设置。临时本地验收入口调用正式 `importLive2DModel(File)`，实际经过 ZIP 校验、解析及 IndexedDB 模型库。此路径不能代替操作系统文件选择器验收。

实测步骤及结果：

1. 选择 Haru → 动作与表情：发现 6 个动作和 8 个表情。修复后未知表情按模型资源索引命名，筛选不再改变名称。
2. 自然待机 1 开启循环：成功播放计数从 2 增至 4，依据真实动作结束续播；停止和切换资源会取消循环。
3. 预览 F01：SDK 成功开始表情播放，随后默认 3.5 秒定时恢复，运行态表情标识清除。
4. 改为再次触发关闭：同一表情持续保留，再次预览后恢复。
5. 将 F01 用于开始分析，设置事件结束后恢复：模拟开始后保留，点击“结束模拟事件”后恢复。
6. 保存：页脚显示“已应用到 Haru：平时播放 2 个动作”，清除未保存数量。
7. 在 Haru 草稿添加两个重叠区域，实际点击预览：反馈“命中 轻点 区域 1 → 尚未设置用途 · 2 个区域重叠，按列表优先级执行”。放弃这两个区域的草稿，不保存。

Hiyori 无表情空状态、待机与键盘分发在上一阶段已有记录；本轮未将该记录冒充新的跨平台实测。

### 可访问性与界面审查范围

范围：Next.js 15 / React 19 设置中的角色资源工作台及未保存确认流程；沿用项目 CSS 变量、原生表单和现有 SVG。未发现 AGENTS.md、CLAUDE.md、CONTRIBUTING.md 或专属界面规范；使用 `docs/live2d.md` 与重设计提案。已读取 better-interface 及六个领域技能。

| 领域 | 检查证据 | 结果与边界 |
| --- | --- | --- |
| Accessibility | Chrome AX、SettingsModal、SettingsConfigLayer、useModalFocus；Tab、Escape 和退出流程 | 主设置保存按钮 Tab 回到关闭按钮；嵌套确认首项聚焦，Tab 不进入背景，Escape 返回取消按钮；关闭后焦点回到页面设置按钮。屏幕阅读器、强制颜色、实际系统减少动态效果尚未验证 |
| Layout | 实际 1497×717 工作台截图、workbench.css | 桌面两个滚动列和固定页脚已观察；本轮 320px 覆盖命令未改变真实 innerWidth，不能记作通过；200% 缩放也未生效 |
| Writing | actionLabels、规则来源、命中与保存状态文案；四语言词典测试 | 修复表情名随筛选变化；不将编号未知资源猜成特定情绪。新词典键已覆盖；本轮未逐一重走四语言渲染 |
| Typography | 桌面截图及工作台换行规则 | 标题、用途和状态可辨；长名称允许换行。窄屏文本放大未实际验证 |
| Colors | 现有语义变量和选中／焦点规则源码 | 未修改全局调色；浅深主题的实际组合对比度未测量，不给颜色合规结论 |
| UI | 循环／停止／表情恢复及命中反馈的真实操作、截图 | 动作有文本状态；减少动态效果的 CSS 和渲染逻辑已修复，但实际系统偏好仍需复核 |

| 等级 | 领域 | 位置 | 原问题 | 已修复行为 | 影响 |
| --- | --- | --- | --- | --- | --- |
| HIGH | Accessibility | `app/components/SettingsModal.tsx`、`SettingsConfigLayer.tsx` | 设置未限制背景和键盘焦点 | dialog 语义、背景 inert、嵌套焦点循环及恢复；侧栏方向键切换 | 避免在打开设置时误操作背景 |
| HIGH | Accessibility | `app/plugins/live2d/Live2DCanvas.tsx`、`workbench.css` | 自动待机／视线仍忽略减少动态效果 | 减少动态效果时保持静帧；显式动作、表情过渡和朗读仍可唤醒；大小变化可单帧重绘 | 避免持续自动运动；系统实测待补 |
| MEDIUM | Writing | `actionLabels.ts`、`ResourceCatalog.tsx` | 表情和未知动作名称随筛选／页码变化 | 使用稳定资源索引／完整目录序号 | 列表、详情和搜索名称一致 |

**审查结论：Approve 仅覆盖上述已检查桌面状态和已修复问题。** 颜色实际对比度、窄屏／200% 缩放、读屏、系统减少动态效果及强制颜色不在通过范围；完整可访问性验收未结束。

### 性能

执行 `npx tsx scripts/live2d-resource-benchmark.ts`，对 100／1,000／5,000 项目录，预热后运行 30 次索引、用途派生及搜索。收尾后复测：5,000 项 median 3.39ms、P95 6.08ms（与构建并行；首次结果为 2.91ms／3.63ms），资源目录最多挂载 50 行。基准验证能找到末尾资源；测试也覆盖自定义名称、未使用筛选和分页上限。

这些是 Node 数据处理时间和目录行数上限，**不是浏览器帧率或整个规则编辑器的耗时**。待机选择框及原生绑定下拉仍可能包含大量选项；真实 5,000 项浏览器交互、低端设备与纹理显存尚未完成验收。

## 生产及桌面构建

在独立临时目录复制当前源码、已校验字典和本地 Core，使用 Node 22.23.3；未复制开发者 `.env.local`，未覆盖运行中的开发服务器 `.next`。

通过：

- `npm run build`：Next.js 15.5.26 生产编译、类型／Lint、静态生成及 standalone 输出成功。
- `npm run desktop:package-server`：桌面服务包含 4,869 个文件。
- `npx tauri build --bundles app`：生成 macOS arm64 `Japanese Analyzer.app`（清理后重新构建为 374.19 MiB）；未发布、未公证。
- 启动打包后的 Node 服务：主页 HTTP 200，9 个页面脚本 HTTP 200，本地 Live2D Core HTTP 200；实际响应 CSP 包含 `worker-src 'self' blob:` 和 `connect-src 'self' blob:`。
- `npm test`、`npm run test:live2d`、`npm run desktop:test`、`npx tsc --noEmit --pretty false`、变更文件 ESLint、`git diff --check`。

构建已有两类非阻断警告：Browserslist 数据较旧；TranslationSettings.tsx 的两个现存未使用导入。本轮未升级依赖或改动无关翻译服务。

## 尚未通过的验收及阻塞

- 浏览器控制恢复时返回 `Debugger unattached`；随后访问 Safari 被工具明确以当前 URL 的访问限制中止。已停止所有界面操作，未绕过限制。
- Safari／iOS、桌面应用实际窗口内模型导入／worker 执行、VoiceOver、实际系统减少动态效果、强制颜色、320px／200% 缩放、浅深主题对比度、长任务下浏览器帧率均不能声明通过。
- `xcrun simctl list devices available` 返回找不到 simctl；当前只有 Command Line Tools，没有可用的 iOS 模拟器。未安装或变更系统开发环境。
- 浏览器验收结束时当前模型为测试 Haru。原 Hiyori 资产及其专属配置保留；工具中止使恢复 Hiyori 和清理浏览器内 Haru 测试配置未能执行。临时 Haru ZIP 保存在 `/tmp/live2d-official-haru.zip`，不删除任何用户原有模型。
- 截图证据：本机 `/tmp/live2d-verification/hotspot-feedback.png`。构建日志位于 `/tmp/live2d-production-build.log`、`/tmp/live2d-package-server.log`、`/tmp/live2d-tauri-build.log`。

最终发布判断：生产与本机 macOS 构建通过，完整跨平台／可访问性验收仍待上述环境可用后补齐。

## 清理与历史决定

删除无人导入的 `Live2DCapabilitySummary.tsx` 及十条专属 CSS；删除临时验收路由和 public 测试 ZIP。配置 v1→v2 迁移与用户资源缺失引用的兼容代码继续保留，它们承担真实数据兼容，不能当成弃用功能删除。

保留既有提交历史，不进行 rebase／squash。原因是前五批的提交哈希已被文档和此前交付引用，重写不会补齐实机验收；当前集成版本和后续批次均可复查。若合并时需要单一提交，可由仓库的合并策略处理。未推送或发布。

## 清理后的最终复核

最终源码重新运行生产构建、桌面服务打包及 `tauri build --bundles app`，均通过。打包服务再检查主页、全部 9 个脚本及 Core 为 HTTP 200，临时 `/live2d-qa` 返回 404。源码 TypeScript 和差异空白检查再次通过。

未配置 Developer ID 的本地包最初不能通过完整的 codesign 资源校验；仅对本次验收产物执行 `codesign --force --deep --sign -` 后，`codesign --verify --deep --strict` 通过。本地 ad-hoc 签名不是 Developer ID 签名／Apple 公证，也未修改产品签名配置。应用未启动实测。

本地最终应用、截图、基准数据和日志保存在 `.desktop-cache/live2d-final-verification/`（已忽略，不入库）。未改动原来的开发 `.next`、桌面包或签名证书。
