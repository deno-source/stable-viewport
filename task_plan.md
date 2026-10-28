# 实施计划

用户已批准PROPOSAL.md，首版覆盖core、React、Next.js、Vue 3、Web Components和普通脚本，交付完整Playwright套件。

- [ ] 单元1（3个配置文件）：工程和依赖基线，核对Node/依赖安全。
- [ ] 单元2（每批最多3个文件）：纯转换逻辑和失败测试，再实现配置与样式回滚。
- [ ] 单元3（每批最多3个文件）：媒体查询、运行时、生命周期和核心API。
- [ ] 单元4（每批最多3个文件）：React/Next、Vue、Web Components/auto独立适配与示例。
- [ ] 单元5（每批最多3个文件）：Playwright场景、真实缩放、SSR、跨框架与卸载回归。
- [ ] 单元6：CLI视觉验收、构建/类型/重复/复杂度/突变检查、tgz安装和文档。

约束：只读Git，不修改CapyBuy；新项目示例用独立端口4379和4380（不占用业务3379）。浏览器控制统一playwright-cli，持续回归Playwright Test；用户规则优先于coverage skill中的MCP流程。不使用不可用的crapper/dryer/mutator冒充结果，以实际可运行工具报告。

状态：工程准备。详细操作和验证结果记入WORK_LOG.md。
