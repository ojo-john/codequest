import type { NextConfig } from "next";

/** Pages that read the cheat sheets from disk at request time; their files must ship with them. */
const CHEATSHEET_FILES = ["./content/cheatsheets/**/*"];

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/cheatsheets": CHEATSHEET_FILES,
    "/cheatsheets/*": CHEATSHEET_FILES,
    "/search": CHEATSHEET_FILES,
  },
};

export default nextConfig;
