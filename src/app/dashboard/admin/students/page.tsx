"use client";

import StudentsTab from "@/components/admin/StudentsTab";
import { useAdminPanel } from "@/components/dashboard/AdminPanelContext";

/** 管理面板「学生管理」（#361） */
export default function AdminStudentsPage() {
  const { students, studentsError, refreshStudents } = useAdminPanel();

  return (
    <StudentsTab
      students={students}
      loadError={studentsError}
      onRetry={refreshStudents}
      onStudentsChanged={refreshStudents}
    />
  );
}
