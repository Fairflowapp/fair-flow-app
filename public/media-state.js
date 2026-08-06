/**
 * media-state.js — shared mutable controller state for the Media module (MY UPLOADS /
 * TO HANDLE / Upload / Work Details), split out of media-upload.js so it can be broken into
 * concern modules that share one source of truth. Also holds module constants and the
 * filter/sort config consumed by the filters + list renderers.
 */
export const mediaState = {
  currentUserProfile: null,
  userWorks: [],
  allWorks: [],
  unsubMyWorks: null,
  unsubAllWorks: null,
  currentMediaTab: "my_uploads",
  selectedWorkId: null,
  currentMediaFilter: "all",
  currentMediaSort: "newest",
  currentMediaEmployeeFilter: "all", // staffId or "all"; only used in TO HANDLE
  currentMediaCategoryFilter: "all", // categoryId or "all"; filter by category
  mediaCategories: [],
  unsubMediaCategories: null,
  /** First Firestore snapshot received (avoid empty-state flash while queries run). */
  mediaMyWorksHydrated: false,
  mediaAllWorksHydrated: false,
  /** Skip tearing down subscriptions when uid/staff/salon/to-handle unchanged (faster return to Media). */
  _mediaWorkListSubKey: "",
};

export const MEDIA_UPLOAD_POINTS_DAILY_CAP = 10;
export const MEDIA_MAX_IMAGES_PER_UPLOAD = 15;

export const MEDIA_DROPDOWN_FLOAT_MQ = "(max-width: 768px)";

export const MY_UPLOADS_FILTERS = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "posted", label: "Posted" },
  { id: "featured", label: "Featured" },
  { id: "archived", label: "Archived" },
];

export const TO_HANDLE_FILTERS = [
  { id: "all", label: "All" },
  { id: "not_posted", label: "Not Posted" },
  { id: "posted", label: "Posted" },
  { id: "featured", label: "Featured" },
  { id: "archived", label: "Archived" },
  { id: "duplicate", label: "Duplicate" },
];

export const SORT_OPTIONS = [
  { id: "newest", label: "Newest" },
  { id: "oldest", label: "Oldest" },
  { id: "most_posted", label: "Most Posted" },
  { id: "featured_first", label: "Featured First" },
];
