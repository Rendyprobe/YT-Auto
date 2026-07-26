import path from "node:path";

export function getPipelineRoot(): string {
  return process.env.PIPELINE_ROOT
    ? path.resolve(process.env.PIPELINE_ROOT)
    : process.cwd();
}
