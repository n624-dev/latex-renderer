export interface PromotionContentCheck {
  path: string;
  candidateContent: string | null;
  stableContent: string | null;
  candidateVersion: string;
  stableVersion: string;
}

export function verifyPromotionContent(options: PromotionContentCheck): void;
export function verifyReleaseCandidatePromotion(
  candidateTag: string,
  stableTag: string,
  repositoryRoot?: string,
): void;
