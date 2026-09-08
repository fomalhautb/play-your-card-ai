import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
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
 */
export default defineConfig({
  // 测试文件在 test/ 下。写出来不只是为了收敛范围：knip 靠这份 include 认出
  // 「这些文件是入口」，不写它会把整个 test/ 报成没人要的死文件。
  test: { include: ['test/**/*.test.ts'] },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        /**
         * 密钥在 .dev.vars 里（不进仓库），测试自己给一份固定的。
         * 测试签 token 用的也是这一串（见 test/helpers.ts），两边必须一样。
         */
        bindings: { JWT_SECRET: 'test-jwt-secret' },
        /**
         * 只在测试里把兼容日期往回压几天。
         *
         * 这个 pool 自带一份 workerd，它认得的最新兼容日期比 wrangler.jsonc 里写的那个早
         *（不压的话 workerd 起不来，报「requires compatibility date ... newest supported is ...」）。
         * 线上那个日期不动：旧转发器还在线上跑，改它是动线上行为。
         * 等 pool 跟上新的 workerd，把这一行删掉。
         */
        compatibilityDate: '2026-08-22',
      },
    }),
  ],
})
