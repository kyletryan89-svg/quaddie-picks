import type { NextConfig } from 'next';
import path from 'node:path';

const nextConfig: NextConfig = {
  // The project lives under a home directory that has its own stray
  // node_modules/package.json; pin Turbopack's workspace root to this repo.
  turbopack: {
    root: path.join(import.meta.dirname),
  },
};

export default nextConfig;
