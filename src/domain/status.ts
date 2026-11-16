/** Estados y transiciones permitidas. Nada de I/O: esto se testea solo. */

export const RUBRIC_STATUSES = ["draft", "in_review", "approved", "closed"] as const;
export type RubricStatus = (typeof RUBRIC_STATUSES)[number];

export const ITEM_STATUSES = [
  "pending",
  "in_progress",
  "ready_for_review",
  "done",
  "blocked",
  "dropped",
] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const TOPIC_STATUSES = ["proposed", "selected", "parked", "discarded"] as const;
export type TopicStatus = (typeof TOPIC_STATUSES)[number];

/**
 * Un tema propuesto se decide una vez. Elegir, aparcar y descartar son
 * reversibles; lo único definitivo es que el descarte vuelve a 'proposed',
 * nunca directo a 'selected'.
 */
const TOPIC_NEXT: Record<TopicStatus, readonly TopicStatus[]> = {
  proposed: ["selected", "parked", "discarded"],
  selected: ["parked", "discarded"],
  parked: ["selected", "discarded"],
  discarded: ["proposed"],
};

/** Una rúbrica aprobada sólo puede cerrarse; cambiarla es crear otra versión. */
const RUBRIC_NEXT: Record<RubricStatus, readonly RubricStatus[]> = {
  draft: ["in_review"],
  in_review: ["approved", "draft"],
  approved: ["closed"],
  closed: [],
};

const ITEM_NEXT: Record<ItemStatus, readonly ItemStatus[]> = {
  pending: ["in_progress", "blocked", "dropped"],
  in_progress: ["ready_for_review", "blocked", "dropped"],
  ready_for_review: ["done", "in_progress", "blocked", "dropped"],
  done: [],
  blocked: ["pending", "in_progress", "dropped"],
  dropped: [],
};

export const canTransitionRubric = (from: RubricStatus, to: RubricStatus): boolean =>
  RUBRIC_NEXT[from].includes(to);

export const canTransitionItem = (from: ItemStatus, to: ItemStatus): boolean =>
  ITEM_NEXT[from].includes(to);

export const canTransitionTopic = (from: TopicStatus, to: TopicStatus): boolean => TOPIC_NEXT[from].includes(to);

export const nextTopicStatuses = (from: TopicStatus): readonly TopicStatus[] => TOPIC_NEXT[from];

export const nextRubricStatuses = (from: RubricStatus): readonly RubricStatus[] => RUBRIC_NEXT[from];
export const nextItemStatuses = (from: ItemStatus): readonly ItemStatus[] => ITEM_NEXT[from];
