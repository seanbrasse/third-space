/** Durable apple mutations are shared by personal inventory and world-story rewards. */
export interface RewardCapacity {
  /** Taken from the last durable read, never from a client command. */
  inventoryRevision: number;
  /** Server checks the five-slot hotbar; an existing apple stack counts as available. */
  appleSlotAvailable: boolean;
}
export type AppleMutation = {
  expectedRevision: number;
  before: number;
  after: number;
  cause: 'harvest' | 'eat' | 'death';
};
