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
  status?: string;
  review_note?: string;
  evidence_name?: string;
  evidence_mime?: string;
  evidence_sha256?: string;
};

export type BanAppealEvent = {
  id: number;
  appeal_id: number;
  actor_id: string | null;
  action: string;
  note: string;
  created_at: string | null;
};

/** `/api/admin/review-queue` qatori — proktor triage ro'yxati. */
export type ReviewQueueRow = {
  exam_id: number;
  exam_title: string;
  student_id: string;
  student_name: string;
  status: string;
  risk_score: number;
  violations_count: number;
  highest_priority: string;
  pending_appeals: number;
  sla_bucket: string;
  recommended_review: boolean;
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
