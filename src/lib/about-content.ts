export interface AboutCapability {
  key: "profile" | "assessment" | "grouping" | "data";
  title: string;
  desc: string;
}

export const ABOUT_META_DESCRIPTION =
  "了解 Career Explorer 的学生档案、职业测评、课堂分组、数据看板与演示沙箱。";

export const ABOUT_INTRO = {
  lead: "把职业探索带进课堂：学生认识自己，教师看见全班，管理员掌握全局。",
  description:
    "Career Explorer 是面向学校课堂的职业探索工具。学生建立个人档案、完成霍兰德与大五测评，并在课堂分组中协作；教师用分组与数据看板组织课堂；管理员负责账户、权限与数据治理。",
} as const;

export const ABOUT_CAPABILITIES: readonly AboutCapability[] = [
  {
    key: "profile",
    title: "学生档案与词云",
    desc: "标签必填、三条匿名他人评价、头像选填；评价自动提词并在本地绘制词云，提交保留历史版本。",
  },
  {
    key: "assessment",
    title: "职业测评",
    desc: "霍兰德每轮 30 题（题库 120 题）+ IPIP 大五 50 题；草稿续答；结果含雷达图、维度解读、三字码与 O*NET 推荐职业。",
  },
  {
    key: "grouping",
    title: "课堂分组与小组工作区",
    desc: "按标签 / 兴趣 / 性格三种特征源智能分组，三种策略、预览调组、组长；小组内公告、任务与已读状态。",
  },
  {
    key: "data",
    title: "数据与演示",
    desc: "教师测评看板、班级完成矩阵、数据列表测评双列、自定义列导出；独立演示库与访客三角色。",
  },
];

export interface AboutRole {
  role: string;
  title: string;
  summary: string;
  points: readonly string[];
}

export const ABOUT_ROLES: readonly AboutRole[] = [
  {
    role: "学生",
    title: "认识自己",
    summary: "从一份档案开始，完成测评并在小组中协作。",
    points: ["我的档案", "我的小组", "职业测评", "历史提交"],
  },
  {
    role: "教师",
    title: "看见全班",
    summary: "用名单、分组与看板组织课堂，掌握每位学生的进展。",
    points: ["名单与班级", "智能分组", "测评看板", "导出与审计"],
  },
  {
    role: "管理员",
    title: "掌握全局",
    summary: "管理账户、配置、存储与演示环境，守住数据边界。",
    points: ["账户与角色", "班级与标签", "存储与备份", "演示环境"],
  },
];

export const ABOUT_STEPS: readonly string[] = [
  "激活：教师导入名单后，凭学号、姓名与班级邀请码激活并设密码。",
  "档案：至少选一个标签、三条匿名他人评价、可选头像；提交后在档案页看词云。",
  "测评：在职业测评中心作答霍兰德（30 题/轮）与 IPIP 大五（50 题），草稿可续答。",
  "小组：教师应用分组后，在「我的小组」看公告、认领任务、跟踪已读。",
  "历史：每次提交生成新版本，在「历史提交」回看与恢复；测评结果在「我的档案」查看。",
];

export interface AboutTrustItem {
  title: string;
  desc: string;
}

export const ABOUT_TRUST: readonly AboutTrustItem[] = [
  {
    title: "测评来源",
    desc: "霍兰德题目改编自 O*NET Career Exploration Tools（依据 O*NET Tools Developer License），职业信息参照 O*NET Database（CC BY 4.0）；IPIP 条目为公有领域；授权文本随测评结果展示。",
  },
  {
    title: "数据隔离",
    desc: "演示库与演示上传目录独立于生产，演示操作不影响生产库与生产上传目录；演示能力默认关闭。",
  },
  {
    title: "权限与审计",
    desc: "三角色权限表 + 路由级班级归属校验；管理域写操作与越权拒绝记审计。",
  },
];

export interface AboutStartItem {
  audience: string;
  desc: string;
}

export const ABOUT_START: readonly AboutStartItem[] = [
  {
    audience: "学生",
    desc: "教师导入名单后通过 /activate 激活，再登录。",
  },
  {
    audience: "教师 / 管理员",
    desc: "使用管理员发放的教师账户或安装时创建的管理员账户登录。",
  },
  {
    audience: "演示",
    desc: "由管理员在「演示环境」发放访客账户后登录演示入口；普通登录页不暴露入口与凭据。",
  },
];

export const ABOUT_CAPABILITY_LINE =
  "职业测评 · 课堂分组 · 小组工作区 · 测评看板 · 演示沙箱";
