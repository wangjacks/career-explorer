import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["mysql2"],
  allowedDevOrigins: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",")
    : [],
  async headers() {
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
      {
        // 带 hash 的静态资源恢复长期缓存（置于其后以覆盖上面的通用规则）
        source: "/_next/static/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
