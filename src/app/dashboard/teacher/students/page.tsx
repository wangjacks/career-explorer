"use client";

import StudentsTab from "@/components/admin/StudentsTab";
import { useTeacherPanel } from "@/components/dashboard/TeacherPanelContext";

/** 教师面板「学生管理」（#361） */
export default function TeacherStudentsPage() {
  const { students, studentsError, refreshStudents } = useTeacherPanel();

  return (
    <StudentsTab
      role="teacher"
      students={students}
      loadError={studentsError}
      onRetry={refreshStudents}
      onStudentsChanged={refreshStudents}
    />
  );
}
