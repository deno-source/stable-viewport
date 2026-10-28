# Stable Viewport 独立组件方案（待批准）

## 目标与项目位置

项目目录：D:\capybuy\stable-viewport。暂定包名stable-viewport，尚未核验npm名称可用性，不发布npm、不初始化或修改Git记录。本阶段仅调研与方案；实现待用户批准。CapyBuy现有代码不迁移、不替换，先交付独立库。

沿用已验证的桌面设计视口策略：以指定设计宽度整体适配，抵消桌面浏览器缩放对页面视觉的影响。浏览器的百分比指示不会被改写。窗口尺寸变化时按设计比例整体缩放。不能把设计视口稳定与所有设备上的物理尺寸完全相同混为一谈。

## 多框架入口、一份核心

1. core：TypeScript框架无关API，导入时不访问window/document，不自动改变页面，支持SSR安全导入。
2. react：可选React入口，React为peer dependency。StableViewport组件透明渲染children，不增加影响布局的div；也允许只在根布局放置无children的控制组件。
3. vue：首版提供Vue 3组件StableViewport与composable useStableViewport，Vue为独立可选peer dependency。组件透明输出默认slot；在onMounted建立适配，在onUnmounted释放，SSR阶段不访问浏览器对象。支持响应式designWidth/enabled和KeepAlive激活/停用，不复制核心引擎。
4. web-component：首版提供原生Custom Element与显式注册函数defineStableViewport，默认标签stable-viewport；无需React/Vue。注册幂等，标签被其他实现占用时明确报错。模块SSR导入安全，浏览器专用对象在注册阶段取得。
5. auto：浏览器独立脚本产物，普通HTML通过script及data-design-width接入。自动执行只存在于该入口，不污染默认模块入口。

Next.js作为React/SSR集成场景提供专门示例与启动恢复验证，首版不重复创建第二套Next运行时。React、Vue适配入口按需导入，使用其中一种不拉入另一种框架。

预期用法：

```tsx
import { StableViewport } from 'stable-viewport/react';

<StableViewport designWidth={1920}>
  <App />
</StableViewport>
```

Vue 3预期用法：

```vue
<script setup lang="ts">
import { StableViewport } from 'stable-viewport/vue';
</script>

<template>
  <StableViewport :design-width="1920" :enabled="true">
    <RouterView />
  </StableViewport>
</template>
```

Web Components预期用法：

```html
<stable-viewport design-width="1920">
  <main id="app">网站原有内容</main>
</stable-viewport>

<script type="module">
  import { defineStableViewport } from '/stable-viewport/web-component.js';
  defineStableViewport();
</script>
```

Web Component的宿主只承担生命周期控制，保持Light DOM，不把站点内容迁入Shadow DOM，也不改变原有选择器或事件路径。推荐让宿主不产生布局盒；可独立空标签接入，也可包裹内容。design-width为数值属性，disabled为标准布尔属性（存在即禁用，不使用enabled="false"）。属性与JS property接口保持一致；connected/disconnected/attributeChanged/adopted生命周期共用core所有权。DOM移动重连不重复安装，跨document移动释放旧document后再接管新document。Web Component接入支持与引擎扫描其他Shadow DOM内部样式是两件事，后者仍需按能力诊断说明边界。

```ts
import { mountViewport } from 'stable-viewport';

const controller = mountViewport({ designWidth: 1920 });
controller.refresh();
controller.getState();
controller.destroy();
```

```html
<script defer src="/stable-viewport.auto.js" data-design-width="1920"></script>
```

以上为待实现接口，不代表包已经发布或功能已完成。

首版参数只保留designWidth、enabled及可选诊断回调等必要项。能力开关按实际集成需要增加，避免提前搭建插件系统。不承诺局部容器隔离：body弹层与全局媒体查询决定首版是全页适配。

## ub-mode封装原则

- 先写失败测试固定现有行为与新生命周期要求，再实现，最后优化结构。
- 参数入口一次校验：designWidth必须为有限正数，非法输入在改变页面前拒绝。
- 单一职责：尺寸计算/值转换为纯逻辑；CSSOM处理、媒体查询适配、生命周期与框架适配分开。
- 同一document只有一个全局补丁管理者。重复接入采用所有权和引用计数；冲突设计宽度明确报错，不能静默互相覆盖。
- destroy幂等：释放事件、MutationObserver、requestAnimationFrame及媒体订阅；恢复根样式、媒体条件、声明与浏览器API。只恢复自身仍持有的改动，保留其他代码之后的修改。
- 清理后可以重新安装。React Strict Mode的setup→cleanup→setup必须与一次正常安装等价。
- 清除CapyBuy品牌、CSS变量前缀、模板路径、语言、接口与业务规则依赖。
- 提供启动状态与诊断：active/disabled/unsupported，以及不可读取样式等能力缺口；不绕过浏览器同源限制。
- 首屏bootstrap与水合后的恢复共用核心。Next.js文档分别说明beforeInteractive与客户端恢复入口，不能仅凭script标签存在判断执行成功。

## 分步交付

每个编码单元最多三个源码/配置文件，完成后验证，再进入下一单元：

1. 工程基线：包清单、严格TypeScript配置、构建入口；依赖确定后检查Node兼容性与安全公告。
2. 纯核心：配置校验、尺寸模型、CSS值和媒体条件转换，并补行为测试。
3. 浏览器运行时：样式适配、全局补丁所有权、生命周期与完整还原。
4. 框架接入分三个小单元：React/Next集成；Vue 3组件/composable；Web Component注册与生命周期。各单元最多三个源码/配置文件，分别验证后再继续，最后接通用script入口。
5. 示例与交付：普通HTML、React、Next.js、Vue 3和原生Web Components的可运行示例及集成说明，构建产物、可安装tgz、API文档、测试报告和操作日志。

不同时修改CapyBuy接入，不发布公共包，不扩展成桌面应用或浏览器扩展。

## 质量门槛与验证

- 单元测试检查尺寸、复杂CSS值、字符串/URL保护、宽高范围条件、非法参数及恢复冲突等行为。
- 浏览器测试用playwright-cli，1920×1080基线；持续回归用Playwright Test。Chrome/Edge通过真实浏览器设置验证25%～500%，不能用CSS zoom或调整viewport冒充。
- 集成场景：SVG/字体图标、HTML尺寸、fixed/sticky、body弹层、动态style/inline、CSSOM insertRule/replace、媒体监听与取消、打印前后、异步加载、SSR恢复。
- 生命周期场景：重复安装、两个组件共享实例、卸载一个仍生效、最后卸载完全恢复、卸载后再次安装、Strict Mode与原有全局样式共存。
- Vue 3专项：组件与composable一致、slot布局不变、props响应式更新、KeepAlive停用/重新激活、SSR导入/水合、卸载清理及与React/原生接入共用document时的引用计数。
- Web Components专项：显式/重复注册、标签冲突、元素晚升级、属性与property更新、disabled布尔语义、动态插入/移除、DOM移动重连、跨document收养、Light DOM选择器与事件兼容、移除最后实例时还原，以及500%下图标/body弹层保持一致。
- 原生滚动与长内容截图单独验收。已知CDP高倍率裁剪坐标问题要用真实视口截图与DOM几何交叉核对，不能为截图伪影修改产品行为。
- 类型检查、构建、打包安装验证；先测试公开API和用户可见效果，再做内部重构。
- ub-mode要求的crapper/dryer/mutator当前没有可用命令或工具，不能声称已运行。计划使用可获得的复杂度检查、重复代码检查和StrykerJS突变测试满足对应目标；选型、安装与实际报告在实施阶段记录，不把替代工具冒称原工具。
- 对新增开发依赖做兼容与安全检查；运行时尽量保持轻依赖。浏览器未实际验证的范围明确列出。

## 已知边界

- 跨域不可读CSS、第三方iframe/Shadow DOM、直接使用innerWidth和client坐标的业务逻辑，需要针对网站诊断或接入调整。不能承诺任意未知网站零改动且完全一致。
- 系统放大镜、操作系统缩放及移动端双指手势不属于桌面页面缩放的同一机制；移动端默认保留原行为。
- 禁用正常放大效果会影响依赖放大阅读的用户；提供enabled控制，接入方应保留可退出的使用方式。
- 首版重点是Chrome/Edge桌面端；Firefox/Safari兼容范围以实际运行证据交付，不用模拟结果代替真机结论。

## 调研依据

- React Effect生命周期与Strict Mode：https://react.dev/reference/react/useEffect
- Next Script入口要求：https://nextjs.org/docs/app/api-reference/components/script
- CSSStyleSheet与同源访问限制：https://developer.mozilla.org/en-US/docs/Web/API/CSSStyleSheet
- CSS zoom语义：https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/zoom
- MediaQueryList事件：https://developer.mozilla.org/en-US/docs/Web/API/MediaQueryList/change_event
- StrykerJS：https://stryker-mutator.io/docs/stryker-js/introduction/
- Vue 3生命周期：https://vuejs.org/api/composition-api-lifecycle
- Vue SSR边界：https://vuejs.org/guide/scaling-up/ssr
- Custom Elements生命周期与属性：https://developer.mozilla.org/en-US/docs/Web/API/Web_components/Using_custom_elements
- HTML标准：https://html.spec.whatwg.org/multipage/custom-elements.html

## 操作日志

- 已读ub-mode、前端规范、通用工作规范、父目录AGENTS及现有缩放实现/验收记录。
- 已核对React、Next.js、MDN与Stryker官方资料；检查专用质量工具可用性，未找到crapper/dryer/mutator。
- 形成独立项目接口、生命周期、验证与分步方案；尚未安装依赖或编写库代码。等待用户批准本方案。
- 用户补充要求Vue 3与Web Components作为正式接入方式，已纳入首版组件、示例、生命周期与回归范围；继续保持单一核心和独立可选框架依赖。
