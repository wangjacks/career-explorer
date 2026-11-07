/**
 * 登录契约：生产 `/api/auth` 与演示 `/api/auth/demo` **共享**的错误文案与 cookie 参数。
 *
 * 抽成单一来源是刻意的——两个登录端点的安全性要求同步演进（将来加限流 / 失败锁定 / 调整
 * 文案时，若各自内联就会静默漂移）。`login-contract.test.ts` 钉住「两个路由都从这里取值、
 * 且不内联这些字符串」，任何一方绕过都会让守卫测试变红。
 *
 * 文案不泄露账号存在性：未知编号与错误口令同为 `badCredentials`；未设密码单独提示。
 * （人机验证文案 `CAPTCHA_REQUIRED_MESSAGE` 归 `@/lib/captcha` 所有，不在此重复。）
 */
export const LOGIN_ERROR = {
  missing: "请输入编号和密码",
  badCredentials: "编号或密码错误",
  noPassword: "该账户尚未设置密码，请联系管理员",
} as const;

/** 会话 cookie 参数（HttpOnly + Secure + sameSite=lax，24h） */
export const AUTH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24,
};
