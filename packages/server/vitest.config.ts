import { fileURLToPath } from 'node:url'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

/**
 * 服务端的测试跑在真的 workerd 里（《正式版架构》6.7）。
 *
 * 不用 happy-dom 之类的假环境：这一层要测的东西——Durable Object 的 SQLite、
 * WebSocket Hibernation、`acceptWebSocket` 的标签、升级请求的头——在假环境里全都没有，
 * 测出来的绿色不代表线上能跑。`@cloudflare/vitest-pool-workers` 直接把测试塞进
 * miniflare 起的 workerd 里，用的是和线上同一套运行时。
 *
 * 写成 vite 插件而不是 `test.poolOptions.workers`：0.22（配 vitest 4）起就是这个形状，
 * 老写法那个 `@cloudflare/vitest-pool-workers/config` 子路径已经没有了。
 *
 * 绑定名、DO 的类和存储后端都从 wrangler.jsonc 读，只有一份定义。
 * D1 也一样：`AUTH_DB` 那条绑定会被 miniflare 在本地现建成一个空库，
 * 建表由 test/setup.ts 跑（见下面 `TEST_MIGRATIONS`）。
 */

/**
 * 建表语句只能在 Node 这一侧读——workerd 里没有文件系统。
 * 读出来当成一条绑定传进去，测试那边再用 `applyD1Migrations` 建表。
 *
 * 路径要从这个文件自己的位置算起，不能写成 './migrations'：
 * knip 是在仓库根目录加载这份配置的，相对路径在那儿指到别处去了。
 */
const migrations = await readD1Migrations(fileURLToPath(new URL('migrations', import.meta.url)))

export default defineConfig({
  test: {
    // 测试文件在 test/ 下。写出来不只是为了收敛范围：knip 靠这份 include 认出
    // 「这些文件是入口」，不写它会把整个 test/ 报成没人要的死文件。
    include: ['test/**/*.test.ts'],
    /**
     * 每个测试文件开跑前先建表、再把账号和密钥备好（见 test/setup.ts）。
     *
     * 必须在这儿而不是各测试文件自己的 `beforeEach`：这个 pool 默认每条测试用例
     * 结束后都会把存储回滚掉，只有 setup 文件和顶层 `beforeAll` 写进去的东西留得住。
     */
    setupFiles: ['./test/setup.ts'],
  },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        /**
         * 密钥在 .dev.vars 里（不进仓库），测试自己给一份固定的。
         * 内容不重要，够长就行——它在测试里只用来加密那把临时生成的 JWT 私钥。
         */
        bindings: {
          BETTER_AUTH_SECRET: 'test-better-auth-secret-at-least-32-chars',
          /**
           * 测试就是开发环境：`room:error malformed` 那条按开发模式回
           *（见 src/devMode.ts）。
           * `.dev.vars` 不参与测试，这一份得自己给。
           */
          DEV: '1',
          TEST_MIGRATIONS: migrations,
        },
        /**
         * 只在测试里把兼容日期往回压几天。
         *
         * 这个 pool 自带一份 workerd，它认得的最新兼容日期比 wrangler.jsonc 里写的那个早
         *（不压的话 workerd 起不来，报「requires compatibility date ... newest supported is ...」）。
         * 线上那个日期不动：改它是动线上行为，而这里要的只是让测试跑得起来。
         * 等 pool 跟上新的 workerd，把这一行删掉。
         */
        compatibilityDate: '2026-08-22',
      },
    }),
  ],
})
