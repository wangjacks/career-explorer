export interface TagCategory {
  name: string;
  tags: string[];
}

export interface WordCloudItem {
  text: string;
  weight: number;
}

export interface Student {
  studentId: string;
  name: string;
  createdAt?: string;
}

export interface UserProfile {
  studentId: string;
  tags: string[];
  avatarUrl: string;
  createdAt?: string;
}
