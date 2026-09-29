import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["mysql2", "@aws-sdk/client-s3", "@aws-sdk/s3-request-presigner"],
  allowedDevOrigins: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",")
    : [],
  async headers() {
    // 带 hash 的静态资源恢复长期缓存（置于其后以覆盖上面的通用规则）。
    // 仅 production 生效：Next 本体默认同样是 immutable，但上面的 catch-all 会把它盖成 no-cache，
    // 所以生产需要这条；而 dev 下 Turbopack 的 chunk 名不带内容哈希，打 immutable 会让浏览器
    // 一直沿用旧 chunk —— 改了客户端代码、重启 dev 也看不到，且 Next 只会打印
    // "Custom Cache-Control headers detected for /_next/static/:path*" 警告（2026-09-29 实际踩到）。
    const staticAssetRule = {
      source: "/_next/static/:path*",
      headers: [
        {
          key: "Cache-Control",
          value: "public, max-age=31536000, immutable",
        },
      ],
    };

    return [
      {
        // 所有 HTML 页面禁止缓存：确保部署更新后浏览器/代理立即拿到新内容
        // （历史问题：仅首页禁缓存，其余静态预渲染页被浏览器/代理缓存，换端口才能看到更新）
        source: "/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
        ],
      },
      ...(process.env.NODE_ENV === "production" ? [staticAssetRule] : []),
    ];
  },
};

export default nextConfig;
