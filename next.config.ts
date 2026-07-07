import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "mysql2"],
  allowedDevOrigins: ["http://10.138.31.166:3000"],
};

export default nextConfig;
