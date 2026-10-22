/**
 * 登录模式视图模型（#350）：生产登录与演示访客登录共用一个页面，
 * 仅提交端点与界面文案不同。仓库无 DOM 测试环境，界面逻辑先落这里再写组件。
 */
export const LOGIN_ENDPOINTS = {
  production: "/api/auth",
  demo: "/api/auth/demo",
} as const;

export type LoginEndpoint = (typeof LOGIN_ENDPOINTS)[keyof typeof LOGIN_ENDPOINTS];

/** 仅 `/login?demo=1` 精确开启演示模式；其余值一律按生产登录处理 */
export function isDemoLoginParam(value: string | null | undefined): boolean {
  return value === "1";
}

export interface LoginMode {
  demo: boolean;
  endpoint: LoginEndpoint;
  navTitle: string;
  title: string;
  description: string;
  submitLabel: string;
  loadingLabel: string;
  showActivation: boolean;
}

const PRODUCTION_MODE: LoginMode = {
  demo: false,
  endpoint: LOGIN_ENDPOINTS.production,
  navTitle: "登录",
  title: "登录",
  description: "使用编号和密码登录（管理员 / 教师 / 学生）",
  submitLabel: "登录",
  loadingLabel: "登录中...",
  showActivation: true,
};

const DEMO_MODE: LoginMode = {
  demo: true,
  endpoint: LOGIN_ENDPOINTS.demo,
  navTitle: "演示登录",
  title: "演示登录",
  description: "使用管理员发放的演示编号与密码登录（演示数据与生产隔离，登录后可切换角色）",
  submitLabel: "演示登录",
  loadingLabel: "演示登录中...",
  showActivation: false,
};

export function resolveLoginMode(demo: boolean): LoginMode {
  return demo ? DEMO_MODE : PRODUCTION_MODE;
}
