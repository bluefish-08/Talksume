import type { MailMessage } from "./mailer.ts";

const SIGNATURE = "\n\n— 简聊 Talksume\n如果这不是你本人的操作，请忽略这封邮件。";

export function verifyEmailMail(to: string, link: string): MailMessage {
  return {
    to,
    subject: "【简聊】请验证你的邮箱",
    text: `你好，\n\n请点击下面的链接验证邮箱，24 小时内有效，只能使用一次：\n${link}${SIGNATURE}`,
  };
}

export function resetPasswordMail(to: string, link: string): MailMessage {
  return {
    to,
    subject: "【简聊】重置密码",
    text: `你好，\n\n请点击下面的链接重置密码，1 小时内有效，只能使用一次。重置后所有已登录的设备都会退出：\n${link}${SIGNATURE}`,
  };
}

export function alreadyRegisteredMail(to: string, loginLink: string, resetLink: string): MailMessage {
  return {
    to,
    subject: "【简聊】该邮箱已注册",
    text: `你好，\n\n有人用这个邮箱尝试注册简聊，但它已经有账号了。\n直接登录：${loginLink}\n忘记密码：${resetLink}${SIGNATURE}`,
  };
}
