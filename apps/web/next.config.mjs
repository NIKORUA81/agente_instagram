/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  transpilePackages: ['@wolfiax/shared'],
  poweredByHeader: false,
};

export default nextConfig;
