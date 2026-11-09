import { DEFAULT_LANGUAGE, isLanguage } from "../../utils/language.js";

type SecurityEmail = "verification" | "resetOtp" | "resetSuccess";

export function securityEmailCopy(
  event: SecurityEmail,
  language: unknown,
  details: { name: string; brandName?: string; year?: number; expirationMinutes?: number },
) {
  const lang = isLanguage(language) ? language : DEFAULT_LANGUAGE;
  const { name, brandName = "Hair Salon", year, expirationMinutes } = details;
  const copy = {
    en: {
      verification: {
        emailSubject: `Verify Your Email - ${brandName}`,
        emailTitle: `Welcome to ${brandName}!`,
        emailIntro: `Thank you for registering with ${brandName}. Please verify your email address to activate your account.`,
        emailInstruction: "Your email verification code is:",
        emailExpiry: `This code expires in ${expirationMinutes} minutes.`,
        emailWarning: "If you did not create this account, please ignore this email.",
        emailFooter: `© ${year} ${brandName}. All rights reserved.`,
      },
      resetOtp: {
        emailSubject: "Reset Your Password",
        emailTitle: "Password Reset Request",
        emailIntro: `Hello ${name}, we received a request to reset your password.`,
        emailInstruction: "Use the OTP below to reset your password:",
        emailExpiry: `This OTP will expire in ${expirationMinutes} minutes. If you did not request a password reset, please ignore this email.`,
        emailWarning: "",
        emailFooter: "© Hair Salon. All rights reserved.",
      },
      resetSuccess: {
        emailSubject: "Password Reset Successful",
        emailTitle: "Password Reset Successful",
        emailIntro: `Hello ${name}, your password has been changed successfully.`,
        emailInstruction: "You can now log in to your Hair Salon System account using your new password.",
        emailExpiry: "",
        emailWarning: "If you did not make this change, please contact support immediately.",
        emailFooter: "© Hair salon. All rights reserved.",
      },
    },
    "zh-CN": {
      verification: {
        emailSubject: `验证您的电子邮箱 - ${brandName}`,
        emailTitle: `欢迎加入 ${brandName}！`,
        emailIntro: `感谢您注册 ${brandName}。请验证您的电子邮箱以激活账户。`,
        emailInstruction: "您的邮箱验证码是：",
        emailExpiry: `此验证码将在 ${expirationMinutes} 分钟后失效。`,
        emailWarning: "如果您未创建此账户，请忽略此邮件。",
        emailFooter: `© ${year} ${brandName}。保留所有权利。`,
      },
      resetOtp: {
        emailSubject: "重置您的密码",
        emailTitle: "密码重置请求",
        emailIntro: `${name}，您好！我们收到了重置您密码的请求。`,
        emailInstruction: "请使用以下验证码重置密码：",
        emailExpiry: `此验证码将在 ${expirationMinutes} 分钟后失效。如果您未请求重置密码，请忽略此邮件。`,
        emailWarning: "",
        emailFooter: "© Hair Salon。保留所有权利。",
      },
      resetSuccess: {
        emailSubject: "密码重置成功",
        emailTitle: "密码重置成功",
        emailIntro: `${name}，您好！您的密码已成功更改。`,
        emailInstruction: "您现在可以使用新密码登录 Hair Salon System 账户。",
        emailExpiry: "",
        emailWarning: "如果此更改并非您本人操作，请立即联系支持团队。",
        emailFooter: "© Hair Salon。保留所有权利。",
      },
    },
    "zh-HK": {
      verification: {
        emailSubject: `驗證您的電郵地址 - ${brandName}`,
        emailTitle: `歡迎加入 ${brandName}！`,
        emailIntro: `感謝您註冊 ${brandName}。請驗證您的電郵地址以啟用帳戶。`,
        emailInstruction: "您的電郵驗證碼是：",
        emailExpiry: `此驗證碼將於 ${expirationMinutes} 分鐘後失效。`,
        emailWarning: "如果您未曾建立此帳戶，請忽略此電郵。",
        emailFooter: `© ${year} ${brandName}。保留所有權利。`,
      },
      resetOtp: {
        emailSubject: "重設您的密碼",
        emailTitle: "密碼重設要求",
        emailIntro: `${name}，您好！我們收到重設您密碼的要求。`,
        emailInstruction: "請使用以下驗證碼重設密碼：",
        emailExpiry: `此驗證碼將於 ${expirationMinutes} 分鐘後失效。如果您未曾要求重設密碼，請忽略此電郵。`,
        emailWarning: "",
        emailFooter: "© Hair Salon。保留所有權利。",
      },
      resetSuccess: {
        emailSubject: "密碼重設成功",
        emailTitle: "密碼重設成功",
        emailIntro: `${name}，您好！您的密碼已成功更改。`,
        emailInstruction: "您現在可以使用新密碼登入 Hair Salon System 帳戶。",
        emailExpiry: "",
        emailWarning: "如果此更改並非由您操作，請立即聯絡支援團隊。",
        emailFooter: "© Hair Salon。保留所有權利。",
      },
    },
  }[lang][event];
  return {
    ...copy,
    emailLanguage: lang,
    emailGreeting: lang === "en" ? `Hello ${name},` : `${name}，您好：`,
  };
}
