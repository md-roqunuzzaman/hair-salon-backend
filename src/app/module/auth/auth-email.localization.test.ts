import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ejs from "ejs";
import { securityEmailCopy } from "./auth-email.localization.js";

const cases = [
  ["verification", "verify-email", ["Verify Your Email - <Brand & Co>", "验证您的电子邮箱 - <Brand & Co>", "驗證您的電郵地址 - <Brand & Co>"]],
  ["resetOtp", "forgot-password", ["Reset Your Password", "重置您的密码", "重設您的密碼"]],
  ["resetSuccess", "reset-password", ["Password Reset Successful", "密码重置成功", "密碼重設成功"]],
] as const;
const languages = ["en", "zh-CN", "zh-HK"] as const;
const details = { name: '<img src=x onerror="alert(1)">', brandName: "<Brand & Co>", year: 2026, expirationMinutes: 5 };

for (const [event, template, subjects] of cases) {
  for (const [index, language] of languages.entries()) {
    test(`${event}: ${language} renders identically in Node and Cloudflare`, async () => {
      const copy = securityEmailCopy(event, language, details);
      assert.equal(copy.emailSubject, subjects[index]);
      const data = { ...details, otp: "123456", ...copy };
      const file = path.resolve(`src/app/templates/${template}.ejs`);
      const nodeHtml = ejs.render(await readFile(file, "utf8"), data);
      const compiled = await import(pathToFileURL(path.resolve("cloudflare/.build/templates.mjs")).href);
      assert.equal(await compiled.default.renderFile(file, data), nodeHtml);
      assert.ok(nodeHtml.includes(`lang="${language}"`));
      assert.ok(nodeHtml.includes("&lt;img src=x onerror=&#34;alert(1)&#34;&gt;"));
      assert.ok(!nodeHtml.includes(details.name));
      assert.ok(!nodeHtml.includes("undefined"));
      if (event !== "resetSuccess") {
        assert.ok(nodeHtml.includes("123456"));
        assert.ok(nodeHtml.includes(copy.emailExpiry));
      }
    });
  }
}

test("missing or unsupported language preserves English fallback", () => {
  for (const language of [undefined, null, "bn", "zh-TW", {}, ""]) {
    for (const [event] of cases) {
      assert.deepEqual(securityEmailCopy(event, language, details), securityEmailCopy(event, "en", details));
    }
  }
});
