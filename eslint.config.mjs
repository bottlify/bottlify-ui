/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";

/*
 * The launcher is checked on its own terms. It is a React application and
 * follows React conventions -- two-space indent, double quotes -- where the
 * engine follows its own. The correctness rules are the engine's, since a bug
 * is a bug in either style; the hooks rules are React's own.
 */
export default [
  {
    ignores: ["dist/**", "node_modules/**", "debug/**"],
  },
  js.configs.recommended,
  {
    files: ["**/*.{js,jsx,mjs}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      // The two established hooks rules; the plugin's React Compiler rules
      // (refs, set-state-in-effect) flag deliberate reads of a ref in render.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",

      indent: ["error", 2, { SwitchCase: 1 }],
      quotes: ["error", "double", { avoidEscape: true }],
      semi: ["error", "always"],
      "comma-dangle": ["error", "always-multiline"],
      "eol-last": ["error", "always"],
      "no-trailing-spaces": "error",
      "object-curly-spacing": ["error", "always"],
      // JSX is compiled away, so no-undef cannot see React's globals or the
      // browser's; the build is what catches a genuinely missing import.
      "no-undef": "off",

      // --- correctness, as in the engine ---
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-shadow": "error",
      "no-throw-literal": "error",
      "no-unmodified-loop-condition": "error",
      "no-self-compare": "error",
      "no-useless-call": "error",
      "no-useless-concat": "error",
      "no-else-return": "error",
      "no-use-before-define": ["error", { functions: false, classes: false, variables: false }],
      "block-scoped-var": "error",
      "no-extra-bind": "error",
      "no-lone-blocks": "error",
      "no-proto": "error",
      "no-template-curly-in-string": "error",
      "no-restricted-globals": ["error", "event"],
      "prefer-const": "error",
      "no-var": "error",

      // --- consistency ---
      "no-multiple-empty-lines": ["error", { max: 2 }],
      "comma-spacing": "error",
      "key-spacing": "error",
      "keyword-spacing": "error",
      "space-in-parens": "error",
      "array-bracket-spacing": "error",
      "block-spacing": "error",
      "no-whitespace-before-property": "error",
      "spaced-comment": ["error", "always"],
    },
  },
];
