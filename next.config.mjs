/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // ESLint runs in CI/pre-commit; skip during build to avoid
    // node_modules resolution issues across environments
    ignoreDuringBuilds: true,
  },
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  images: {
    formats: ["image/avif", "image/webp"],
  },
};

export default nextConfig;
