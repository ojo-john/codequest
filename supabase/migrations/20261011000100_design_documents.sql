-- Design challenges (spec §29, §59) keep each written section as a Markdown document in the
-- learner's project. Project files were Java-only; this admits exactly one more shape,
-- design/<section-id>.md, so nothing else (and no Markdown elsewhere) can be saved. The executor
-- and archive checks only ever run the .java files.

alter table public.project_files drop constraint project_files_path_check;
alter table public.project_files add constraint project_files_path_check check (
  char_length(path) <= 200 and (
    path ~ '^([A-Za-z_][A-Za-z0-9_-]*/)*[A-Za-z_][A-Za-z0-9_]*\.java$'
    or path ~ '^design/[a-z0-9]+(-[a-z0-9]+)*\.md$'
  )
);
