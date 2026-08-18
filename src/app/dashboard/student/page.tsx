import NavigationBar from "@/components/NavigationBar";

/** 学生面板占位页（实质内容在后续步骤实现） */
export default function StudentDashboardPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <NavigationBar title="学生面板" showHome />
      <main className="min-h-[calc(100vh-3rem)] flex items-center justify-center px-4">
        <div className="w-full max-w-sm sm:max-w-md bg-white rounded-2xl shadow-sm border border-gray-100 p-8 space-y-6 text-center">
          <div className="w-16 h-16 bg-green-100 rounded-2xl flex items-center justify-center mx-auto">
            <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">学生面板</h1>
            <p className="text-sm text-gray-500 mt-2">建设中，将在后续版本上线</p>
          </div>
        </div>
      </main>
    </div>
  );
}
