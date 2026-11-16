import { expect, it } from "vitest";
import { isHiddenFilePath } from "./hidden-files";

// One rule with the Rust side's (plugins/access/tests.rs): the same names.
it("lets a plugin ask for a hidden file by name, never one that holds keys or tokens", () => {
  for (const ok of [
    ".vitepress/config.ts",
    ".obsidian/app.json",
    ".github/workflows/ci.yml",
  ])
    expect(isHiddenFilePath(ok), ok).toBe(true);
  for (const secret of [
    ".git/config",
    ".git-credentials",
    ".env.local",
    ".ssh/id_ed25519",
    ".config/gh/hosts.yml",
    ".cursor/mcp.json",
    ".mcp.json",
    ".zsh_history",
    ".vault-token",
    ".terraformrc",
    ".aws/credentials",
    ".certs/site.pem",
    "notes/visible.md",
    ".a/../b",
  ])
    expect(isHiddenFilePath(secret), secret).toBe(false);
});
