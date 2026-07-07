export interface TagCategory {
  name: string;
  tags: string[];
}

export interface WordCloudItem {
  text: string;
  weight: number;
}

export interface UserProfile {
  id?: number;
  tags: string[];
  avatarUrl: string;
  createdAt?: string;
}
