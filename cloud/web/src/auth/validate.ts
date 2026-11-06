export const MIN_PASSWORD = 8;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function emailError(value: string): string | undefined {
  return EMAIL.test(value.trim()) ? undefined : "请填写正确的邮箱地址";
}

export function newPasswordError(value: string): string | undefined {
  return value.length >= MIN_PASSWORD ? undefined : `密码至少 ${MIN_PASSWORD} 位`;
}
