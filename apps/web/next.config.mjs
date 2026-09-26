/**
 * Next.js config for DramaFlow Studio web UI.
 * - Proxies /api/* to the local desktop-server (default port 5174).
 */
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@dramaflow/domain"],
  async rewrites() {
    const target = process.env.DRAMAFLOW_API_BASE || "http://127.0.0.1:5174";
    return [{ source: "/api/:path*", destination: `${target}/api/:path*` }];
  },
};

export default nextConfig;
