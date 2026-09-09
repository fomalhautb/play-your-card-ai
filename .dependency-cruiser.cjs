/**
 * 包与包之间的依赖方向检查，对应《正式版架构》7.2 第 1 条和 6.2 的边界那几条。
 *
 * 为什么不用 Biome 做这件事：Biome 看的是"这行 import 写了什么字符串"，
 * 而依赖方向要看"解析之后落在哪个包里"——`@ai-duel/core`、`../../core/src/x`、
 * 甚至将来的 tsconfig paths 别名都会落到同一个文件上。dependency-cruiser 跑的是解析后的模块图。
 * 两边分工：跨包只走包入口那条（7.2 第 2 条）在 biome.jsonc 的 noRestrictedImports，
 * 方向这条在这里。
 * 第三方也在图里，只是当叶子、不往里追（见 options 里 exclude 和 doNotFollow 两段注释），
 * 所以「core 只许 pure-rand」「canvas 不碰 react」「ui 不碰 pixi」这类包对第三方的边界
 * 也写在这里；Biome 那边按 import 字符串匹配，只管包内目录级的禁令
 * （比如 canvas/src/director 不碰 pixi.js / gsap）。
 *
 * 只扫 packages/ 和 apps/ 下的 src：测试、构建配置、一次性脚本不属于产品的依赖图，
 * 它们依赖 vitest、vite、playwright 是正常的，扫进来只会逼着为它们写一堆例外。
 *
 * 用法：`pnpm lint`，或单独跑 `pnpm exec depcruise packages apps`。
 *
 * 一个坑：dependency-cruiser 18 只认 typescript >=2 <7，本仓库用的是 TypeScript 7。
 * 它找不到能用的 tsc 时不会报错，只会把所有 .ts 跳过——输出是
 * 「0 modules cruised，没有违规」，看着全绿其实一行都没查。
 * 所以根 package.json 的 pnpm.packageExtensions 给 dependency-cruiser 单独塞了一份 typescript 6，
 * 项目自己仍然用 7。等它支持 TS 7 之后把那段删掉。
 * 改完这份配置记得看一眼输出里的模块数不是 0。
 */

/** 包名 → 它允许依赖的其他包（不含自己）。改这里等于改《正式版架构》7.2 第 1 条，先去改文档。 */
const ALLOWED = {
  core: [],
  content: ['core'],
  protocol: ['core'],
  design: [],
  platform: [],
  // canvas 多一个 core：演出编排层（src/director）要读引擎的事件和视图类型。
  canvas: ['core', 'design', 'platform'],
  ui: ['design', 'platform'],
  client: ['core', 'content', 'protocol', 'design', 'platform', 'canvas', 'ui'],
  server: ['core', 'content', 'protocol'],
  bench: ['canvas', 'design', 'platform'],
}

/** `^packages/(a|b|c)/` 这种正则片段。 */
const packagesGroup = (names) => `^packages/(${names.join('|')})/`

/**
 * 一条「这个包只许依赖这几个包」的规则。
 *
 * to 的写法是「落在 packages/ 里、但不在允许名单里」——不限制第三方依赖，
 * 那是 knip 和各自 package.json 的事，这里只管包与包的方向。
 * 对第三方的限制不走这个生成器，单独写在下面：
 * core 只许 pure-rand、canvas 不碰 react、ui 不碰 pixi。
 */
const packageRule = (name, allowed) => ({
  name: `依赖方向-${name}`,
  severity: 'error',
  comment: allowed.length
    ? `packages/${name} 只能依赖 ${allowed.join('、')}。见《正式版架构》7.2 第 1 条。`
    : `packages/${name} 不能依赖任何别的包。见《正式版架构》7.2 第 1 条。`,
  from: { path: `^packages/${name}/src/` },
  to: {
    path: '^packages/',
    pathNot: packagesGroup([name, ...allowed]),
  },
})

module.exports = {
  forbidden: [
    ...Object.entries(ALLOWED).map(([name, allowed]) => packageRule(name, allowed)),

    {
      name: '依赖方向-core-不碰第三方',
      severity: 'error',
      comment:
        'core 是纯函数规则引擎，运行时依赖只有 pure-rand（确定性随机数）一个。' +
        '再多一个第三方就意味着它要跟着别人的运行环境走，而它必须能在浏览器和 Worker 里一模一样地跑。',
      from: { path: '^packages/core/src/' },
      to: {
        dependencyTypes: ['npm', 'npm-dev', 'npm-optional', 'npm-peer', 'npm-no-pkg'],
        pathNot: '(^|/)node_modules/pure-rand/',
      },
    },

    {
      name: '依赖方向-谁都不能依赖-client',
      severity: 'error',
      comment:
        'client 是装配层，它依赖所有人，所以没有任何包可以反过来依赖它——那必成环。' +
        '只有 apps/ 下的三个壳可以。见《正式版架构》7.2 第 1 条。',
      from: { path: '^packages/(?!client/)' },
      to: { path: '^packages/client/' },
    },

    {
      name: '依赖方向-apps-只挂-client',
      severity: 'error',
      comment:
        'apps/ 下的壳只有入口和构建配置，不写业务：它们只挂 client，' +
        '要用别的包就说明业务写进壳里了。壳自己的平台库（react、electron、capacitor）不受这条管。',
      from: { path: '^apps/' },
      to: {
        path: '^packages/',
        pathNot: '^packages/client/',
      },
    },

    {
      // 6.2：core 不 import 浏览器或 Node 对象。
      // 浏览器那半边这里查不了——window / document 是全局变量不是 import，
      // 由 biome.jsonc 里 noRestrictedGlobals 的 override 盯着。
      name: '边界-底层包不碰-node-内建',
      severity: 'error',
      comment:
        'core、content、protocol、design 要能原样跑在浏览器、Cloudflare Worker 和 Node 三种环境里，' +
        '碰了 node:fs 这类内建模块就只剩 Node 一种。见《正式版架构》6.2。',
      from: { path: `${packagesGroup(['core', 'content', 'protocol', 'design'])}src/` },
      to: { dependencyTypes: ['core'] },
    },

    {
      /*
       * 6.5 / 迁移第 16 条：演出编排是一台纯 TS 的时间驱动状态机，
       * 输入是事件批和玩家操作，输出是演出指令，渲染怎么放是渲染器的事。
       * 碰了 platform 就意味着它开始认识真实时间、真实设备或真实网络，假时钟测试立刻失效；
       * canvas 里别的目录（Pixi 组件、场景）同样不该被它 import——那是反过来的方向。
       *
       * 「不许 import pixi.js / gsap」那半条**不在这里**，在 biome.jsonc 的 noRestrictedImports。
       * 分工是：包与包之间的方向在这里，包内禁止的 import 在 Biome。
       * 下面这条规则只写 `^packages/`，所以它管不到第三方——真要在这里也拦一道，
       * 得照「边界-canvas-不碰-react」那样另写一条按 node_modules 路径匹配的。
       */
      name: '边界-director-只许依赖-core-和-design',
      severity: 'error',
      comment:
        'packages/canvas/src/director 是纯 TS 的演出编排层，只能依赖 @ai-duel/core（事件和视图的类型）' +
        '和 @ai-duel/design（时长令牌），不许碰 @ai-duel/platform，也不许 import canvas 自己的 Pixi 部分。' +
        '见《正式版架构》6.5。',
      from: { path: '^packages/canvas/src/director/' },
      to: {
        path: '^packages/',
        pathNot: '^packages/(core|design)/|^packages/canvas/src/(director/|runtime/rng\\.ts$)',
      },
    },

    {
      name: '边界-canvas-不碰-react',
      severity: 'error',
      comment:
        'canvas 里是 Pixi 场景，画布上的东西一律不进 DOM，也就用不着 React。' +
        '真需要文字型界面，那部分属于 ui。见《正式版架构》第 2 节。',
      from: { path: '^packages/canvas/src/' },
      to: { path: '(^|/)node_modules/react(-dom)?/' },
    },

    {
      name: '边界-ui-不碰-pixi',
      severity: 'error',
      comment:
        'ui 是画布外的 React 组件库，碰 Pixi 就说明有卡牌或大动画漏到了 DOM 那边。' +
        '它也不许依赖 canvas，那条由上面的「依赖方向-ui」管。见《正式版架构》第 2 节、7.1 第 1 条。',
      from: { path: '^packages/ui/src/' },
      to: { path: '(^|/)node_modules/pixi\\.js/' },
    },

    {
      name: 'no-unresolvable',
      severity: 'error',
      comment:
        'import 的东西解析不到。跨包时这条几乎总是同一个原因：用了 @ai-duel/xxx 却没在本包的 ' +
        'package.json 里声明依赖——pnpm 只给声明过的包建软链。' +
        '这条必须留着，否则解析不了的 import 会被当成"没有这条依赖"，上面的方向规则一条都拦不住它。',
      from: {},
      to: {
        couldNotResolve: true,
        // `cloudflare:workers` 是 Workers 运行时的内建模块，磁盘上没有对应文件，
        // 由 wrangler 在部署时提供，本来就解析不到。
        pathNot: '^cloudflare:',
      },
    },

    {
      name: 'no-circular',
      severity: 'error',
      comment:
        '循环依赖会让 import 进来的东西在某些时序下是 undefined，而且报错点离病根很远。' +
        '见《正式版架构》6.2。',
      from: {},
      to: { circular: true },
    },

    {
      name: 'no-orphans',
      severity: 'error',
      comment:
        '既没人 import、自己也不 import 任何东西的文件，多半是重构漏删的。' +
        '包入口（src/index.ts）和壳入口（src/main.tsx）不算：入口本来就没有上游，' +
        '骨架阶段它们还只有一句 export {}，那是预期状态不是问题。',
      from: {
        orphan: true,
        pathNot: ['^packages/[^/]+/src/index\\.ts$', '^apps/[^/]+/src/main\\.tsx$', '\\.d\\.ts$'],
      },
      to: {},
    },
  ],

  options: {
    /*
     * 冻结的旧客户端排除在 lint 之外（迁移第 7 条）。
     * 它的依赖方向本来就不符合新结构，扫它只会得到一堆改不了的报错。
     */
    exclude: {
      path: [
        '^packages/legacy-client/',
        /*
         * node_modules **不在**这里。以前它被整个摘掉，结果是「指向第三方的边根本不在图里」，
         * 于是 core 只许 pure-rand、canvas 不碰 react、ui 不碰 pixi 这三条一次都没触发过，
         * 输出照样是绿的。第三方靠下面的 doNotFollow 收：进图当叶子，但不往里追。
         */
        '(^|/)dist/',
        // 组件目录页的静态产物（`build-storybook` 打的），进了 .gitignore 但磁盘上有。
        '^packages/client/storybook-static/',
        // 测试和构建配置不属于产品依赖图，见文件头的说明。
        '^packages/[^/]+/test/',
        '\\.config\\.(ts|js|cjs|mjs)$',
      ],
    },
    /*
     * 第三方进图，但不往里追：第三方内部长什么样和依赖方向无关，
     * 知道「谁依赖到了它」就够了。不加这条扫一次要几十秒。
     *
     * 这条和上面 exclude 里那段是配套的：**别**再把 node_modules 塞回 exclude。
     * exclude 是「当这个文件不存在」，边一起没了；doNotFollow 是「到此为止」，边还在。
     * 认第三方的那几条规则（core 只许 pure-rand、canvas 不碰 react、ui 不碰 pixi）
     * 全靠这些边，改成 exclude 它们会一声不响地全部失效，输出还是绿的。
     */
    doNotFollow: { path: '(^|/)node_modules/' },
    /*
     * 让它按 TypeScript 的规则解析。tsconfig.base.json 里 moduleResolution 是 Bundler，
     * 而各包的 exports 直接指向 src/index.ts，所以 @ai-duel/core 会解析到源码而不是构建产物——
     * 依赖图里看到的就是真实的 packages/core/src/index.ts。
     */
    tsConfig: { fileName: 'tsconfig.base.json' },
    // 把 `import type` 也算进依赖图。类型也是跨包耦合：
    // protocol 引了 canvas 的类型，方向一样是错的，只是编译产物里看不出来。
    tsPreCompilationDeps: true,
    // pnpm 的 workspace 包是 node_modules 里的符号链接，
    // 不解开的话每个包会被当成不同的模块，依赖图对不上。
    combinedDependencies: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'types', 'node', 'default'],
      mainFields: ['module', 'main', 'types'],
      extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
}
