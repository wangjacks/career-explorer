export interface TagCategory {
  name: string;
  tags: string[];
}

export interface WordCloudItem {
  text: string;
  weight: number;
}

export interface User {
  id: number;
  userCode: string;
  role: "admin" | "teacher" | "student";
  name: string;
  classId: number | null;
  tags: number[];
  avatarUrl: string | null;
  evaluationUrl: string | null;
  submittedAt: string | null;
  createdAt: string;
}
