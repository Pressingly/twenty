import { COMMON_PRELOAD_TOOLS } from 'src/engine/core-modules/tool-provider/constants/common-preload-tools.const';
import { GET_TOOL_CATALOG_TOOL_NAME } from 'src/engine/core-modules/tool-provider/tools/get-tool-catalog.tool';
import { LEARN_TOOLS_TOOL_NAME } from 'src/engine/core-modules/tool-provider/tools/learn-tools.tool';
import { LOAD_SKILL_TOOL_NAME } from 'src/engine/core-modules/tool-provider/tools/load-skill.tool';

type McpToolAnnotations = {
  readOnlyHint: boolean;
  destructiveHint: boolean;
};

const READ_ONLY: McpToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
};

const DESTRUCTIVE_WRITE: McpToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
};

const READ_ONLY_TOOL_NAMES = new Set<string>([
  ...COMMON_PRELOAD_TOOLS,
  GET_TOOL_CATALOG_TOOL_NAME,
  LEARN_TOOLS_TOOL_NAME,
  LOAD_SKILL_TOOL_NAME,
]);

// MCP clients confirm a call with the user unless the tool is marked read-only.
// execute_tool can run any workspace tool, so it and any tool not listed above
// are published as writes.
export const getMcpToolAnnotations = (toolName: string): McpToolAnnotations =>
  READ_ONLY_TOOL_NAMES.has(toolName) ? READ_ONLY : DESTRUCTIVE_WRITE;
