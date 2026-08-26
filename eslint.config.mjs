// eslint-config-next@16 ships native flat config (next + next/typescript).
import next from 'eslint-config-next';

const eslintConfig = [
  {
    // Root tooling configs — next/babel chokes on plain .mjs and there is no
    // app code in them worth linting.
    ignores: ['**/eslint.config.mjs', '**/postcss.config.mjs'],
  },
  ...next,
  {
    rules: {
      // The scoring module is deliberately dependency-free; nothing here needs
      // to be relaxed. Keep defaults strict.
    },
  },
];

export default eslintConfig;
