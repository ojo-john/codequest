/** Where a design challenge's section is saved in the learner's project (shared by server and client). */
export const designPath = (sectionId: string): string => `design/${sectionId}.md`;

/** The only non-Java path a project may hold (mirrors the project_files path check). */
const DESIGN_PATH = /^design\/[a-z0-9]+(-[a-z0-9]+)*\.md$/;

export const isDesignDocument = (path: string): boolean => DESIGN_PATH.test(path);
