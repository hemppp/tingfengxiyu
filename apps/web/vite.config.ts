import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { createHtmlPlugin } from 'vite-plugin-html';

export default defineConfig({
  plugins: [
    react(),
    createHtmlPlugin({
      minify: false,
      inject: {
        tags: [
          {
            tag: 'meta',
            attrs: {
              name: 'referrer',
              content: 'strict-origin-when-cross-origin',
            },
            injectTo: 'head',
          },
          {
            tag: 'meta',
            attrs: {
              'http-equiv': 'Content-Security-Policy',
              content: [
                "default-src 'self'",
                "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com",
                "style-src 'self' 'unsafe-inline' https://www.gstatic.com",
                "img-src 'self' data: https: blob:",
                "font-src 'self' data:",
                "connect-src 'self' http://localhost:* https: wss: ws:",
                "frame-src 'none'",
                "object-src 'none'",
                "base-uri 'self'",
              ].join('; '),
            },
            injectTo: 'head',
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5174,
    strictPort: true,
    headers: {
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3774',
        changeOrigin: true,
        secure: false,
        configure: (proxy) => {
          // 仅保留错误日志，减少高频请求日志输出
          proxy.on('error', (err) => {
            console.warn('[Vite Proxy] 连接失败:', err.message);
          });
        },
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false, // 生产构建关闭 sourcemap 减少体积
    // 关闭压缩体积报告，加速 CI；提升大依赖告警阈值，避免 @ant-design/plots 等噪音
    reportCompressedSize: false,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // ★ 函数式 manualChunks：用 id 前缀匹配，解决 gsap/ScrollTrigger 等子路径漏配问题
        //   之前对象形式只能匹配精确包名，gsap/ScrollTrigger 会被切到独立小 chunk 增加请求数
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // React 生态核心：react + react-dom + react-router + zustand + framer-motion + gsap
            //   + @xyflow/react + @ant-design/plots
            // ★ 这些包互相依赖形成循环（motion↔react, flow→charts→react→flow），
            //   拆分会导致 React exports 初始化失败（Cannot set properties of undefined (setting 'Activity')）
            //   和 TDZ 错误（Cannot access 'xx' before initialization），全部合并到 vendor-react 消除循环
            if (
              id.includes('react-router') ||
              id.includes('react-dom') ||
              /[\\/]react[\\/]/.test(id) ||
              id.includes('zustand') ||
              id.includes('framer-motion') ||
              id.includes('gsap') ||
              id.includes('@gsap/') ||
              id.includes('@xyflow/') ||
              id.includes('@ant-design/plots') ||
              id.includes('@ant-design/g-')
            ) {
              return 'vendor-react';
            }
            // Tiptap 编辑器（含 core/pm 子包）
            if (id.includes('@tiptap/')) {
              return 'vendor-editor';
            }
            // 图标库
            if (id.includes('lucide-react')) {
              return 'vendor-icons';
            }
            // 地图
            if (id.includes('leaflet')) {
              return 'vendor-map';
            }
            // 3D 图谱（three.js + d3-force-3d）
            if (id.includes('three') || id.includes('d3-force-3d')) {
              return 'vendor-three';
            }
            // 液态玻璃效果
            if (id.includes('liquid-glass-react')) {
              return 'vendor-glass';
            }
            // Markdown 渲染
            if (id.includes('react-markdown') || id.includes('remark-') || id.includes('micromark') || id.includes('mdast-')) {
              return 'vendor-markdown';
            }
            // d3 力导向
            if (id.includes('d3-force') || id.includes('d3-quadtree') || id.includes('d3-dispatch') || id.includes('d3-timer')) {
              return 'vendor-d3';
            }
            // 导出工具
            if (id.includes('html-to-image') || id.includes('dompurify')) {
              return 'vendor-export';
            }
            // 通用工具
            if (id.includes('nanoid')) {
              return 'vendor-utils';
            }
          }
        },
      },
    },
  },
  // 依赖预构建优化：显式指定大型依赖，减少首次启动扫描时间
  // ★ 补全大依赖，避免首次访问对应路由时触发 deps 重新打包导致 dev 卡顿
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-router-dom',
      'zustand',
      'gsap',
      'gsap/ScrollTrigger',
      '@gsap/react',
      '@tiptap/react',
      '@tiptap/starter-kit',
      '@tiptap/core',
      'lucide-react',
      '@xyflow/react',
      'leaflet',
      'framer-motion',
      'three',
      'three/addons/controls/OrbitControls.js',
      'd3-force-3d',
      'd3-force',
      'd3-force',
      'react-markdown',
      'html-to-image',
      'dompurify',
    ],
  },
});
