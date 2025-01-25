import { ESLint } from "eslint"; // ESLint itself, if required.
import typescriptEslint from "@typescript-eslint/eslint-plugin"; // Importing the plugin.
import parser from "@typescript-eslint/parser"; // Correcting the TypeScript parser import.
import prettier from "eslint-plugin-prettier";
import importPlugin from "eslint-plugin-import"; // Correcting the import plugin.

export default [
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: parser, // Using the correct variable name here.
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        project: "./tsconfig.json", // Ensure it points to the correct TypeScript config file.
      },
    },
    plugins: {
      "@typescript-eslint": typescriptEslint,
      "prettier": prettier,
      "import": importPlugin,  // Explicitly include import plugin.
    },
    rules: {
      // TypeScript Specific Rules
      "@typescript-eslint/explicit-function-return-type": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/explicit-module-boundary-types": "warn",
      "@typescript-eslint/no-empty-function": "error",

      // Code Quality and Consistency
      "quotes": ["error", "single"],
      "semi": ["error", "always"],
      "no-console": "off",
      "prefer-const": "error",
      "eqeqeq": ["error", "always"],
      "curly": ["error", "all"],
      "no-var": "error",
      "object-shorthand": ["error", "always"],

      // Code Formatting (integrates with Prettier)
      "prettier/prettier": [
        "error",
        {
          "singleQuote": true,
          "semi": true,
          "trailingComma": "all",
          "printWidth": 80,
          "tabWidth": 2,
        },
      ],

      // Best Practices
      "no-duplicate-imports": "error",
      "no-return-await": "error",
      "no-undef": "off", // TypeScript handles this.
      "no-shadow": "off", // Use @typescript-eslint version below.
      "@typescript-eslint/no-shadow": ["error"],

      // Import Rules
      "import/order": [
        "warn",
        {
          "groups": [
            "builtin",
            "external",
            "internal",
            ["sibling", "parent"],
            "index",
          ],
          "newlines-between": "always",
        },
      ],
    },
  },
];
