# 网页本地解析

在输入区上方将「解析方式」切换为「本地解析」，输入原文后点击解析。
默认仍为模型解析；主动选择本地模式后会记住该偏好。

- 首次使用会下载约 77 MB 的 Sudachi Core 词典，进度显示在页面上。
  压缩词典分块保存在浏览器 IndexedDB，后续从缓存加载；缓存不可用时仍可
  完成本次解析，但下次可能需要重新下载。可用「清除词典缓存」删除这些资源。
- 分词在浏览器 Web Worker 内运行，不需要模型密钥，原文不会随本地解析请求
  发送到服务器。下载资源需要联网；这不是支持离线打开整个网站的 PWA。
  已打开页面且词典已缓存时，解析可在无网络情况下运行。
- 本地结果标为初稿。原文完整还原不等于读音、学校文法词性完全正确；
  日期、数词、同形异音词及部分形容动词活用仍需检查。
- 点击「用模型校正」才会将各块完整上下文和初稿发送给当前配置的模型。
  使用当前模型、密钥、能力与思考开关；每次请求最多 8192 输出 token、120 秒。
  每个目标块最多 80 个词项、180 个 NFC 字符，并携带前后各最多 120 个字符的
  只读上下文。最多三个请求并发，失败块只进行一轮拆分或原块重试；随后仍失败时
  保留本地词项，支持只重试失败部分，并复用成功块。
- 校正期间不会把未经校验的响应替换到初稿上。停止、编辑、新任务或模型设置
  变化后，迟到响应不能覆盖当前结果。校正完成前暂停手动分词调整。
- 校正协议 v2 只允许模型返回 `sourceIds`、`pos` 和 `furigana`。单词属性修改使用
  `[5]`，合并相邻初稿词项使用 `[5,6]`；编号必须非空、升序、连续、界内且与
  其他修改不重叠。模型不返回 `word`，服务端从不可变的 Sudachi 初稿重建词面，
  因此模型不能漏字、增字、改字或改变 Unicode 表示，也不能拆分单个 A 模式词项。
  词性只接受学校文法枚举和一组确定性别名，读音转为平假名后只接受假名与长音符；
  记号和换行读音必须为空。任一修改非法时整块拒绝，不挑选部分修改。
- 传给模型的词面和上下文使用 NFC 便于理解，应用状态始终保留原始码元。直接模型
  解析路径也只接受 NFC 等价输出并映射回原文；不使用 NFKC，半角／全角、标点替换、
  缺字和增字仍会触发完整性失败。
- 校正正文可为纯 JSON，或由单个完整 JSON Markdown 围栏包裹的同一 JSON。
  只移除完整外层围栏，不从说明/思考文字中截取对象，不补括号、不修复语法，
  不提取截断输出的有效前缀。仍先验证正常结束信号，再检查全部修改项。
  提示词中的示例使用完整合法 JSON，不包含省略号占位符。
- 结构化输出能力按模型保存。DeepSeek 直连 Chat 预设使用 `json_object`，方舟预设
  使用 `json_schema`；自定义模型默认 `json_object`。连接测试会依次验证普通聊天、
  严格 Schema 和 JSON 模式，并显示实际可用级别。无论上游声称何种能力，本地验证
  都不会省略；请求仍使用 Chat Completions，不会自动切换供应商专用接口。
- 本地和模型解析成功后，均会按所选翻译来源自动翻译。默认使用 MyMemory，
  会将完整原文发送给该服务；本地离线分词与联网翻译是两个独立步骤。
  翻译失败不会丢失解析结果，也不会自动改用付费模型。查询 AI 词义、模型润色
  和其他 AI 功能仍需主动点击。翻译邮箱、额度与缓存见[句子翻译说明](translation.md)。
- 当前每次本地解析最多 12000 个 UTF-16 码元。浏览器需支持 Worker、WASM
  与 Web Crypto，使用 HTTPS 或 localhost。内存不足或资源加载失败时可以
  停止任务、刷新或选择模型解析；不会自动转为付费模型请求。

已在本机生产构建的 Chrome 155 和 WebKit 27.2 验证。Core WASM 线性内存
约 197 MiB，初始化还有解压等额外开销；尚未覆盖低内存手机或所有桌面发行包。

## 部署与构建

`npm run dev` 和 `npm run build` 会运行 `analyzer:prepare`：验证已提交的 WASM，
下载并验证固定版本词典，将上游 ZIP 中已压缩的字典项拆为每块最多 4 MB，
写入忽略提交的 `data/local-analyzer/`，并从 TypeScript 源码生成公共 Worker。
常规构建无需 Rust 或 Python；需要 Node 22 与项目开发依赖。

资源由同源 `/api/local-analyzer/dictionary/[hash]` 提供，沿用站点会话认证，
只允许清单中的 SHA-256 文件名，并在服务端和浏览器校验资源。
Next standalone、Docker 和桌面打包包含这些资源。桌面 CSP 仅额外允许
WASM 编译及同源 Worker；不开放通用 `unsafe-eval` 或外部 Worker。

`local-analyzer.lock.json` 固定源包、词典包、原始字典、清单和 WASM 摘要。
词典版本更新须显式修改锁文件并重新交叉验证，不跟随浮动的最新版。
`app/lib/localAnalyzerManifest.json` 是固定压缩字典的确定性分块清单。

## 从源码重建 WASM

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.129 --locked
npm run analyzer:build-wasm
```

本次产物使用 Rust 1.99.0；另一编译器版本可能产生不同字节。重建脚本会验证
上游 0.7.0 源包，仅应用已列出的浏览器适配，然后按 Cargo.lock 构建。
不同产物会导致摘要检查失败；审查变化后可显式使用
`npm run analyzer:build-wasm -- --update-lock` 更新产物摘要。
可用 `SUDACHI_WASM_BINDGEN` 指定固定版本工具的路径。

适配包括：关闭浏览器不可用的动态库加载与词典编译入口、补齐 32 位散列常量、
以内存加载固定词典并使用上游内置插件。`…`、`㍿` 等规范化展开的零宽原文词项
按相邻原文范围合回，保留读音；不将规范形替换为原文。
学校文法转换与前一轮实验共用同一实现，罗马音仍由现有本地逻辑生成。

## 验证

```sh
npm test
npm run analysis:engines:test
npm run analyzer:verify-wasm
# 完成引擎对照后，可逐字段比较同版本 Python 参考输出：
npm run analyzer:verify-wasm -- --native-reference .codex-dev/local-engines/sudachi-core-A.raw.json
# 可选浏览器测试：先安装实验工具和 WebKit，再启动本站。
npm ci --prefix scripts/analysis-lab/engines
node scripts/analysis-lab/engines/node_modules/playwright-core/cli.js install webkit
node scripts/local-analyzer/browser-smoke.mjs
```

浏览器测试使用临时配置，不读取用户的浏览器资料或模型密钥。
自动化浏览器回归的校正环节使用模拟响应；后端认证、参数、结束信号和原文校验另有回归测试。
另在用户现有浏览器配置上执行了真实模型请求，结果独立记录于下述实测报告。
这些功能实测未对语言质量评分，也未按统一计时协议测端到端性能。

校正校验失败时，页面显示具体原因，Network 中该请求的 `error.code` 和
`error.details` 区分上游不支持 Schema、Schema 形状违规、JSON 合法但违反 v2 协议、
非法词性／读音、越界、非连续与重叠。JSON 格式错误按具体原因返回，区分上游外层响应、完成信号、
模型正文三个阶段。缺少结束信号、截断、思考混入、非 JSON 说明、未闭合 JSON
和其他语法错误都有独立分类；不会把这些失败当作已校正。
服务端 `[local-correction-diagnostic]` 记录协议版本、Schema 指纹、结构化输出模式、
目标词项数、只读上下文长度、块范围、尝试次数、结束原因、上游 request ID 及长度/耗时。
格式诊断还包含上游响应长度/类型、正文形态和思考字符数；发生白名单词性映射时只记录数量。
上游可能不遵守 Schema，后端始终执行完整协议与语义校验。
运行时可提供时记录 JSON 错误位置（相对于去除完整外层围栏及首尾空白后的 JSON）。
这些诊断不记录原文、词项/读音、模型正文、思考正文、解析器原始异常、端点或密钥。
真实模型对照结果见
`scripts/analysis-lab/results/correction-live.json`；它与模拟上游回归分开记录，
不把同字编码问题修复等同于语言质量或总体稳定性已获保证。

`sudachi-wasm.json` 记录 76 个输入的完整性和原生输出一致性，以及小型固定语料的
30/30 基础预期和 17/21 额外读音目标；这些分数不是日语总体准确率。
`sudachi-web.json` 记录临时浏览器配置下的首次加载、缓存加载和引擎复用时间，
以及损坏缓存修复、清除缓存、显式校正、取消和 375px 布局验证。
首次加载包含从本机 HTTP 服务获取 77 MB 词典，不能外推为真实网络下载速度；
缓存与复用阶段使用短压力用例，也不能直接作为长文的三组速度对照。

源与许可见 [NOTICE](../NOTICE) 和 LICENSES 中的 Sudachi/fflate 声明；
WASM 依赖声明也发布在 `/local-analyzer/NOTICE.txt`。前期引擎比较见
[对照报告](../scripts/analysis-lab/engines/RESULTS.md)。
