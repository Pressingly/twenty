import { GET_TOOL_CATALOG_TOOL_NAME } from 'src/engine/core-modules/tool-provider/tools/get-tool-catalog.tool';
import { LEARN_TOOLS_TOOL_NAME } from 'src/engine/core-modules/tool-provider/tools/learn-tools.tool';
import { LOAD_SKILL_TOOL_NAME } from 'src/engine/core-modules/tool-provider/tools/load-skill.tool';

export const MCP_READ_ONLY_TOOL_NAMES: ReadonlySet<string> = new Set([
  GET_TOOL_CATALOG_TOOL_NAME,
  LEARN_TOOLS_TOOL_NAME,
  LOAD_SKILL_TOOL_NAME,
  'search_help_center',
]);
