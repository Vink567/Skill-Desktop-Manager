import { describe, expect, it } from "vitest";
import { messageFromError } from "../src/renderer/errorMessage";

describe("renderer error messages", () => {
  it("removes Electron remote method wrappers", () => {
    const error = new Error(
      "Error invoking remote method 'skills:installFromGitHub': Error: GitHub 导入失败：无法克隆 https://github.com/obra/superpowers.git。"
    );

    expect(messageFromError(error)).toBe(
      "GitHub 导入失败：无法克隆 https://github.com/obra/superpowers.git。"
    );
  });
});
