# 虚拟角色服务收尾验收（2026-10-21）

本轮按“反馈与恢复 → 循环与目录性能 → 模型与可访问性 → 生产构建 → 清理”的顺序推进。代码完成和实机验收分别记录；本报告不等于所有平台已通过。

## 2026-10-22 验收更新与待验收清单

本节状态优先于下方 2026-10-21 的历史记录。未验收表示缺少证据，不表示已经发现功能故障。

已补齐：Chrome 320px 窄屏和实际 200% 缩放、浅深主题抽样对比度；macOS 桌面 WKWebView 中通过系统文件选择器导入 Haru、动作与表情预览及恢复、本地字典／worker 解析、多短句朗读与气泡／原文同步高亮；最终生产构建、全量测试、桌面测试以及应用运行后的 ad-hoc 签名校验。原 Chrome Hiyori 及其配置已恢复，测试 Haru 保留，未删除用户模型。

修复提交：`8e724c7`（焦点与对比度）、`7aefb29`（Pixi 在严格 CSP 下初始化）、`9737f96`（高缩放／低窗口高度布局）、`99825f3`（静态品牌图不写安装包缓存）。未放宽 CSP，未使用 Developer ID 签名或公证。

5,000 项合成资源在 Chrome 开发模式实测分页和检索：每页 50 行，成功找到末尾资源；记录到的 React commit 渲染时间最大约 21.2ms。这不是帧率，也不涵盖大量真实纹理、手机 GPU 或长任务压力。

| 编号 | 待验收范围 | 当前原因／边界 | 后续执行及通过标准 |
| --- | --- | --- | --- |
| QA-01 | macOS Safari 完整流程 | 当前 Safari 网页触发界面工具访问限制，已停止，未绕过；桌面 WKWebView 结果不能代替 Safari | 可访问的 Safari 环境中重走模型 ZIP 导入、预览／循环／停止、表情恢复、保存及重启、本地解析、音频与同步高亮；无控制台错误或流程阻塞 |
| QA-02 | iPhone／iPad 的 iOS Safari | 本机只有 Command Line Tools，缺少 simctl；无已连接测试设备 | 实机检查高 DPI 清晰度、触摸拖拽／滑杆、横竖屏／安全区／软键盘、图片聊天、音频解锁、恢复前台；不溢出、不误选、音画正常 |
| QA-03 | VoiceOver 屏幕阅读器 | 已测 AX 和键盘焦点，不等同于实际读屏 | 在设置、资源目录、预览、规则和未保存确认中逐项读出名称／角色／状态；不进入背景，关闭后焦点恢复 |
| QA-04 | 实际系统“减少动态效果” | 代码及媒体查询路径已修复，尚未在实际系统偏好下验收 | 打开偏好后停用持续自动动作／跟随，保留显式预览与朗读；关闭后恢复；测试结束还原偏好 |
| QA-05 | 强制颜色模式 | 现有系统颜色替代样式尚未运行验证 | 支持环境中检查焦点、选中状态、滑杆、滚动条、按钮边界；所有关键状态可辨 |
| QA-06 | 低端移动设备与真实大模型压力 | 数据目录测试不覆盖纹理显存、发热或整页帧率 | 多模型与大纹理长时间切换、缩放、滚动、朗读；记录帧耗时、内存和 WebGL context 丢失，按设备给出结果 |
| QA-07 | Windows 系统语言识别 | 本机无 Windows 环境／交叉目标 | 在 Windows 上分别验证简体、繁体、英文、韩文、未支持语言顺序匹配；首次启动、手动覆盖、恢复跟随系统、重启后启动页与主页一致；原生 API 实测通过后再关闭此项 |

本机证据（已忽略，不入库）：`.desktop-cache/live2d-final-verification/` 下的 `desktop-reading.png`、`desktop-final-workbench.png`、`narrow-keyboard.png`、`zoom-200-preview.png`、`dark-contrast.json`、`catalog-5000-browser.json` 及 `live2d-20261022-*.log`。最终应用也在此目录。

## 2026-10-22 验收产物清理

已按用户要求清理旧应用包、编译输出和独立临时生产工作区。现在仅保留 `.desktop-cache/system-language-verification/Japanese Analyzer.app`；历史章节提到的其他 `.app`、QA 专用包和临时构建目录已删除，截图、JSON、日志证据保留。所有 `~/Library` 应用运行数据（包括独立 QA 数据）均未删除，Chrome 内模型和配置也未改动。

新增受限清理命令及桌面构建成功后的自动清理钩子，使用方式和保留策略见 [桌面文档](desktop.md#调试产物清理)。自动化不触及用户数据与编译缓存。13 项桌面测试通过，包含预览无副作用、保留最新应用、7 天保留期、运行中保护、符号链接边界、未知目录保护、进程查询失败中止及旧解压目录处理；已实际运行自动钩子，保留应用签名校验通过。

## 2026-10-22 系统语言自动识别

提交 `76230f7` 接入原生／浏览器系统语言匹配与手动覆盖。此处的默认行为取代此前「首次默认中文」描述；找不到支持的首选语言时仍回退简体中文。已有手动语言继续保留，新增「跟随系统」入口并显示实际匹配语言。

实现与测试：

- Mac 使用 `NSLocale.preferredLanguages`，Windows 使用 `GetUserPreferredUILanguages(MUI_LANGUAGE_NAME)`；按用户首选顺序匹配，简繁脚本优先于地区推断。原生和 JavaScript 的 15 组匹配样例共用同一份 JSON 测试契约。
- 启动页使用原生匹配结果；仅将受支持的语言代码通过 `ja_system_language` 共享给主页。`ja_ui_language` 保存手动选择或 `system` 模式，不把自动结果误存为手动语言。
- `npm test`、`npm run desktop:test`（8 项）、Rust 单元测试（7 项）、TypeScript、变更文件 ESLint、diff 检查、生产构建、桌面服务打包和 macOS arm64 构建通过。
- Mac 原配置：原来的手动简体中文在升级后保留；菜单检测到系统 English。选择 System 后主页使用英文；重启时启动页显示英文 Loading，主页仍为英文且保持 System。随后恢复原来的手动简体中文。
- 新建独立测试包标识／数据目录，未清空用户配置：首次启动的动画提示和译文自动采用英文，进入新主页后为英文，语言菜单默认选中 System English；没有导入任何模型、密钥或历史。完成后已关闭独立测试应用。
- 键盘实测：Down 打开语言菜单并聚焦选中项，End 到末项，Escape 关闭并恢复语言按钮焦点。菜单使用已有 menuitemradio 语义和勾选状态；VoiceOver 未实测，不扩大可访问性验收结论。
- Windows 接口代码通过独立 Rust metadata 类型检查，**未在 Windows 上链接、运行或验收**，保留 QA-07。跨平台匹配契约通过不能代替原生接口实测。

审查范围内无新增可操作的可访问性问题；Approve 仅覆盖语言菜单的上述名称、状态与键盘路径。原有 QA-01～QA-07 仍按各自证据关闭。

本机证据与最终应用：`.desktop-cache/system-language-verification/` 中的 `Japanese Analyzer.app`、`system-language-menu.png`、`first-launch-home.png`、`first-launch-system.png`、构建及测试日志。首次启动使用的独立 QA 包也留在该目录供复查。两份本地包均采用 ad-hoc 签名，未发布／公证；未更改本机系统语言，未推送远程。

原生接口依据：[Apple preferredLanguages](https://developer.apple.com/documentation/foundation/locale/preferredlanguages)、[Microsoft GetUserPreferredUILanguages](https://learn.microsoft.com/en-us/windows/win32/api/winnls/nf-winnls-getuserpreferreduilanguages)。安装器语言选择本轮未改动。

## 2026-10-22 新问题修复与回归

| 问题／等级 | 位置 | 原因与修复 | 证据与边界 |
| --- | --- | --- | --- |
| 手机画质／MEDIUM | `app/plugins/live2d/renderQuality.ts:3`、`Live2DCanvas.tsx` | 手机与桌面原本已经共用引擎；旧策略在 DPR=1 时只绘制 1×，并忽略 pinch zoom。统一最低目标 2×，按 DPR×visualViewport.scale 计算，保留 4×／6MP／GPU 上限；遮罩最高 2048；resize 后保持 CSS 尺寸 100% | Chrome 390px 的 DPR=1 窄屏环境中，同一舞台约 249×344 的缓冲变为 497×688；单元测试覆盖 DPR=3、捏合倍率与 GPU 上限。不将桌面窄屏模拟记为手机实机通过，QA-02／QA-06 继续保留 |
| 启动语言／MEDIUM | `src-tauri/tauri-ui/desktop.js`、`src-tauri/src/main.rs:35`、`app/contexts/LanguageContext.tsx:11` | 两个 localStorage 来源隔离，且启动页按系统语言、主页默认中文。统一默认中文，桥接受支持的语言偏好。首次实测暴露 Wry 的 IP 主机 Cookie 过滤问题，进一步修复固定主机匹配 | 最终 macOS 包依次验证中文启动→中文主页、切换英文并重启→英文启动／主页、恢复中文并重启→中文启动／主页；未新增偏好文件；原语言已恢复。繁中／韩语通过解析测试，未分别启动实测 |
| 重复导航／LOW | `app/plugins/live2d/Live2DSettings.tsx:131` | 删除「角色」按钮，保留动作与表情／互动设置，使用唯一返回入口；返回后聚焦「管理角色」 | Chrome DOM 与 macOS 实际窗口确认两个按钮；浏览器实际返回焦点为「管理角色」 |

**Approve 仅覆盖上述实际检查的界面与修复范围。** 未执行手机实机、Safari、屏幕阅读器或系统偏好专项，不扩大可访问性通过范围。布局密度及预览中角色占比保持现有设计。

捏合缩放不会改变 DPR，倍率来自 [MDN devicePixelRatio](https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio) 与 [VisualViewport.scale](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport/scale)。这也是独立监听 visualViewport resize 并更新缓冲的原因。

本次提交：`1added6`（统一画质与缩放）、`d1f3db1`（去掉重复角色入口）、`bba468a` 与 `81e2195`（启动语言及实测修正）。通过 `npm test`、`npm run desktop:test`（7 项）、`cargo test --manifest-path src-tauri/Cargo.toml`（5 项）、TypeScript、变更文件 ESLint 与 diff 检查；独立目录的 Next 生产构建、桌面服务打包和 macOS arm64 应用构建通过（374.33 MiB），运行后 `codesign --verify --deep --strict` 通过。

本轮最终应用与证据保存在 `.desktop-cache/live2d-followup/`：`Japanese Analyzer.app`、`desktop-navigation.png` 及 `live2d-followup-*.log`。手机尺寸截图因当前浏览器截图工具输出缩放异常，仅作操作记录，不用于判断真实手机画质；缓冲尺寸读取记录与单元测试用于验证渲染策略。原开发视口已恢复，原模型配置未改动。

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
