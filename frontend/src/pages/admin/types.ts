export type Level = { id: number; name: string };

export type Kafedra = {
  id: number;
  name: string;
  code?: string | null;
  sort_order?: number;
  is_active?: boolean;
  direction_count?: number;
};

export type Direction = {
  id: number;
  name: string;
  kafedra_id?: number | null;
  kafedra_name?: string | null;
  kafedra_ids?: number[];
  kafedra_names?: string[];
};

export type Group = {
  id: number;
  name: string;
  level_id: number;
  level_name: string;
  direction_id?: number | null;
  direction_name?: string | null;
  program_track?: string;
  academic_year?: number | null;
  intake_year?: number | null;
  is_active?: boolean;
  student_count?: number;
};

export type StudentRow = {
  id: string;
  name: string;
  role: string;
  status: string;
  /* O'qituvchi / ordinator / magistr GURUHGA emas, KAFEDRAGA biriktiriladi. */
  kafedra_id?: number | null;
  kafedra_name?: string | null;
  position?: string;
  stavka?: string;
  group_id: number | null;
  profile_image?: string | null;
  has_photo?: boolean;
  group_name?: string | null;
};

export type BanAppeal = {
  id: number;
  student_id: string;
  student_name: string;
  exam_title?: string;
  reason: string;
  created_at: string;
};

export type AdminStats = {
  totalUsers: number;
  totalExams: number;
  totalViolations: number;
  bannedUsers: number;
  totalKafedralar: number;
  totalDirections: number;
  totalLevels: number;
  totalGroups: number;
  totalStudents: number;
  totalFaculty?: number;
  totalOrdinators?: number;
  totalMagistrs?: number;
  totalVacancy?: number;
};
