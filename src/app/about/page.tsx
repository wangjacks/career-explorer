import type { Metadata } from "next";
import Link from "next/link";
import { Compass, Sparkles, Users, BarChart3 } from "lucide-react";
import NavigationBar from "@/components/NavigationBar";
import SiteFooter from "@/components/SiteFooter";
import pkg from "../../../package.json";

export const metadata: Metadata = {
  title: "关于 · Career Explorer",
  description: "关于 Career Explorer 学生职业探索工具",
};

const features = [
  {
    icon: Sparkles,
    title: "学生探索",
    desc: "选择兴趣、技能、性格标签，生成专属词云与虚拟形象，完成一份属于自己的职业探索档案。",
  },
  {
    icon: Users,
    title: "教师管理",
    desc: "创建班级、管理学生账户、查看提交进展，一键导出班级数据。",
  },
  {
    icon: BarChart3,
    title: "数据统计",
    desc: "提交进度、标签分布、班级概览一目了然，支持数据大屏与备份恢复。",
  },
];

export default function AboutPage() {
  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-b from-green-50 to-white pb-16 md:pb-0">
      <NavigationBar title="Career Explorer" showHome />
      <main className="flex-1 w-full max-w-3xl mx-auto px-6 py-12 space-y-10">
        {/* 产品介绍 */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-green-500 flex items-center justify-center shadow-md">
              <Compass size={24} strokeWidth={2} className="text-white" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">关于 Career Explorer</h1>
          </div>
          <p className="text-gray-600 leading-relaxed">
            Career Explorer 是一款面向学生的职业探索工具。学生通过选择兴趣、技能与性格标签，
            生成个性化的职业探索档案；教师与管理员在后台管理班级、查看统计并导出数据，
            帮助每一位学生迈出认识自我、探索职业方向的第一步。
          </p>
        </section>

        {/* 功能一览 */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-800">主要功能</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {features.map((f) => (
              <div key={f.title} className="bg-white rounded-xl border border-gray-100 p-5 space-y-2 shadow-sm">
                <f.icon size={20} className="text-green-600" />
                <h3 className="font-medium text-gray-800">{f.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* 探索流程 */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-800">学生探索流程</h2>
          <ol className="space-y-2 text-gray-600 text-sm leading-relaxed list-decimal list-inside">
            <li>输入学号开始（已注册的学生也可登录后在面板中修改）</li>
            <li>选择兴趣 / 技能 / 性格标签</li>
            <li>查看专属标签词云</li>
            <li>上传同学评价词云与虚拟形象</li>
            <li>完成提交，生成职业探索档案</li>
          </ol>
          <Link
            href="/"
            className="inline-block mt-2 px-5 py-2.5 bg-green-500 hover:bg-green-600 text-white text-sm font-medium rounded-xl transition-colors shadow-sm"
          >
            返回主页开始探索
          </Link>
        </section>

        {/* 版本信息（动态读取 package.json，发布时随 npm version 更新） */}
        <div className="space-y-1.5 pt-4 border-t border-gray-100">
          <p className="text-xs text-gray-400">
            Career Explorer v{pkg.version} · 三角色支持（学生 / 教师 / 管理员）
          </p>
          <p className="text-xs text-gray-400">本站使用小米 MiSans 字体</p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
